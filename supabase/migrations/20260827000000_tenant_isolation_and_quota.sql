-- PartnerIQ tenant isolation and atomic research quota.
-- Legacy cache rows have no deterministic tenant mapping, so fail rather than
-- silently assigning them to a default tenant.

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  research_quota_limit integer NOT NULL DEFAULT 100 CHECK (research_quota_limit >= 0),
  quota_period interval NOT NULL DEFAULT interval '1 day' CHECK (quota_period = interval '1 day'),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (tenant_id, user_id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.company_identities)
     OR EXISTS (SELECT 1 FROM public.company_profiles)
     OR EXISTS (SELECT 1 FROM public.company_diffs) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'legacy_cache_tenant_mapping_required';
  END IF;
END;
$$;

ALTER TABLE public.company_identities
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.company_diffs
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.company_identities ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.company_profiles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.company_diffs ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.company_profiles DROP CONSTRAINT IF EXISTS company_profiles_identity_fk;
ALTER TABLE public.company_diffs DROP CONSTRAINT IF EXISTS company_diffs_identity_fk;
ALTER TABLE public.company_identities DROP CONSTRAINT IF EXISTS company_identities_pkey;
ALTER TABLE public.company_profiles DROP CONSTRAINT IF EXISTS company_profiles_pkey;
ALTER TABLE public.company_diffs DROP CONSTRAINT IF EXISTS company_diffs_pkey;
DROP INDEX IF EXISTS public.idx_company_identities_tax_id;

ALTER TABLE public.company_identities
  ADD CONSTRAINT company_identities_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE public.company_profiles
  ADD CONSTRAINT company_profiles_pkey PRIMARY KEY (tenant_id, id, version),
  ADD CONSTRAINT company_profiles_identity_fk FOREIGN KEY (tenant_id, id)
    REFERENCES public.company_identities(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.company_diffs
  ADD CONSTRAINT company_diffs_pkey PRIMARY KEY (tenant_id, id),
  ADD CONSTRAINT company_diffs_identity_fk FOREIGN KEY (tenant_id, company_id)
    REFERENCES public.company_identities(tenant_id, id) ON DELETE CASCADE;

CREATE UNIQUE INDEX idx_company_identities_tenant_tax_id
  ON public.company_identities (tenant_id, tax_id)
  WHERE tax_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_company_identities_domain;
DROP INDEX IF EXISTS public.idx_company_identities_name;
DROP INDEX IF EXISTS public.idx_company_profiles_lookup;
DROP INDEX IF EXISTS public.idx_company_profiles_updated;
DROP INDEX IF EXISTS public.idx_company_profiles_complete;
DROP INDEX IF EXISTS public.idx_company_diffs_company;

CREATE INDEX idx_company_identities_tenant_domain
  ON public.company_identities (tenant_id, normalized_domain);
CREATE INDEX idx_company_identities_tenant_name
  ON public.company_identities (tenant_id, normalized_name);
CREATE INDEX idx_company_profiles_tenant_lookup
  ON public.company_profiles (tenant_id, id, version DESC);
CREATE INDEX idx_company_profiles_tenant_updated
  ON public.company_profiles (tenant_id, updated_at DESC);
CREATE INDEX idx_company_profiles_tenant_complete
  ON public.company_profiles (tenant_id, id, version DESC)
  WHERE analysis_report IS NOT NULL;
CREATE INDEX idx_company_diffs_tenant_company
  ON public.company_diffs (tenant_id, company_id, created_at DESC);

CREATE TABLE public.research_quota_periods (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  quota_limit integer NOT NULL CHECK (quota_limit >= 0),
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= quota_limit),
  PRIMARY KEY (tenant_id, period_start),
  CHECK (period_end > period_start)
);

CREATE TABLE public.research_quota_reservations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  operation text NOT NULL CHECK (length(btrim(operation)) > 0),
  cost integer NOT NULL CHECK (cost > 0),
  period_start timestamptz NOT NULL,
  allowed boolean NOT NULL,
  remaining integer NOT NULL CHECK (remaining >= 0),
  reset_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, period_start)
    REFERENCES public.research_quota_periods(tenant_id, period_start) ON DELETE RESTRICT
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_quota_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_quota_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tenants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tenant_memberships FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.research_quota_periods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.research_quota_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.company_identities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.company_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.company_diffs FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_memberships TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.research_quota_periods TO service_role;
GRANT SELECT, INSERT ON public.research_quota_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.company_identities TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.company_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.company_diffs TO service_role;

-- Worker membership contract. A supplied hint must be an active membership.
-- Without a hint, exactly one membership is required; zero is access denied and
-- multiple memberships require an explicit tenant selection.
CREATE OR REPLACE FUNCTION public.resolve_research_tenant(
  p_user_id uuid,
  p_tenant_hint uuid DEFAULT NULL
)
RETURNS TABLE (tenant_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_membership_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant_access_denied';
  END IF;

  IF p_tenant_hint IS NOT NULL THEN
    SELECT tm.tenant_id INTO v_tenant_id
    FROM public.tenant_memberships tm
    WHERE tm.user_id = p_user_id
      AND tm.tenant_id = p_tenant_hint;

    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant_access_denied';
    END IF;
  ELSE
    SELECT count(*), min(tm.tenant_id::text)::uuid
    INTO v_membership_count, v_tenant_id
    FROM public.tenant_memberships tm
    WHERE tm.user_id = p_user_id;

    IF v_membership_count = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant_access_denied';
    ELSIF v_membership_count > 1 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'tenant_selection_required';
    END IF;
  END IF;

  RETURN QUERY SELECT v_tenant_id;
END;
$$;

-- Cache v2 RPCs are service-role-only and tenant-scoped. Membership is already
-- validated by the Worker; the origin verifies the signed tenant before calling.
CREATE OR REPLACE FUNCTION public.lookup_company_identities_v2(
  p_tenant_id uuid,
  p_tax_id text,
  p_domain text,
  p_name text
)
RETURNS TABLE (
  id text,
  tax_id text,
  normalized_domain text,
  normalized_name text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ci.id, ci.tax_id, ci.normalized_domain, ci.normalized_name, ci.created_at, ci.updated_at
  FROM public.company_identities ci
  WHERE ci.tenant_id = p_tenant_id
    AND (
      (p_tax_id IS NOT NULL AND ci.tax_id = p_tax_id)
      OR (p_domain IS NOT NULL AND ci.normalized_domain = p_domain)
      OR (p_name IS NOT NULL AND ci.normalized_name = p_name)
    )
  ORDER BY ci.id;
$$;

CREATE OR REPLACE FUNCTION public.resolve_company_identity_v2(
  p_tenant_id uuid,
  p_tax_id text,
  p_domain text,
  p_name text,
  p_candidate_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_resolved_id text;
  v_tax_owner_id text;
BEGIN
  v_tenant_id := p_tenant_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'tenant_required';
  END IF;

  IF p_candidate_id IS NULL OR btrim(p_candidate_id) = '' OR p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_identity';
  END IF;

  IF p_tax_id IS NOT NULL AND p_domain IS NOT NULL THEN
    SELECT ci.id INTO v_tax_owner_id
    FROM public.company_identities ci
    WHERE ci.tenant_id = v_tenant_id AND ci.tax_id = p_tax_id;

    IF v_tax_owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.company_identities ci
      WHERE ci.tenant_id = v_tenant_id
        AND ci.normalized_domain = p_domain
        AND ci.id <> v_tax_owner_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.company_identities ci
      WHERE ci.tenant_id = v_tenant_id
        AND ci.normalized_domain = p_domain
        AND ci.id = v_tax_owner_id
    ) THEN
      RAISE EXCEPTION 'identity_conflict';
    END IF;
  END IF;

  IF p_tax_id IS NOT NULL THEN
    INSERT INTO public.company_identities (tenant_id, id, tax_id, normalized_domain, normalized_name)
    VALUES (v_tenant_id, p_candidate_id, p_tax_id, p_domain, p_name)
    ON CONFLICT (tenant_id, tax_id) WHERE tax_id IS NOT NULL DO NOTHING;

    SELECT ci.id INTO v_resolved_id
    FROM public.company_identities ci
    WHERE ci.tenant_id = v_tenant_id AND ci.tax_id = p_tax_id;
  ELSIF p_domain IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_tenant_id::text || ':' || p_domain, 0)
    );

    SELECT ci.id INTO v_resolved_id
    FROM public.company_identities ci
    WHERE ci.tenant_id = v_tenant_id
      AND ci.normalized_domain = p_domain
      AND ci.normalized_name = p_name
    ORDER BY ci.id
    LIMIT 1;

    IF v_resolved_id IS NULL THEN
      INSERT INTO public.company_identities (tenant_id, id, normalized_domain, normalized_name)
      VALUES (v_tenant_id, p_candidate_id, p_domain, p_name)
      RETURNING id INTO v_resolved_id;
    END IF;
  ELSE
    INSERT INTO public.company_identities (tenant_id, id, normalized_name)
    VALUES (v_tenant_id, p_candidate_id, p_name)
    RETURNING id INTO v_resolved_id;
  END IF;

  RETURN v_resolved_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_latest_research_snapshot_v2(
  p_tenant_id uuid,
  p_company_id text
)
RETURNS TABLE (
  version integer,
  profile_data jsonb,
  analysis_report jsonb,
  diff_data jsonb,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT cp.version, cp.data, cp.analysis_report, cd.data, cp.updated_at
  FROM public.company_profiles cp
  LEFT JOIN public.company_diffs cd
    ON cd.tenant_id = cp.tenant_id
   AND cd.company_id = cp.id
   AND cd.to_version = cp.version
  WHERE cp.tenant_id = p_tenant_id
    AND cp.id = p_company_id
    AND cp.analysis_report IS NOT NULL
  ORDER BY cp.version DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.persist_research_snapshot_v2(
  p_tenant_id uuid,
  p_company_id text,
  p_tax_id text,
  p_domain text,
  p_name text,
  p_version integer,
  p_expected_version integer,
  p_profile_data jsonb,
  p_analysis_report jsonb,
  p_diff_data jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_now timestamptz := timezone('utc'::text, now());
  v_official_name text;
  v_diff_id text;
  v_from_version integer;
  v_to_version integer;
BEGIN
  v_tenant_id := p_tenant_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'tenant_required';
  END IF;

  PERFORM 1
  FROM public.company_identities ci
  WHERE ci.tenant_id = v_tenant_id AND ci.id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'identity_not_found';
  END IF;

  IF p_tax_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_identities ci
    WHERE ci.tenant_id = v_tenant_id
      AND ci.tax_id = p_tax_id
      AND ci.id <> p_company_id
  ) THEN
    RAISE EXCEPTION 'identity_conflict';
  END IF;

  IF p_expected_version <> COALESCE((
    SELECT max(cp.version)
    FROM public.company_profiles cp
    WHERE cp.tenant_id = v_tenant_id AND cp.id = p_company_id
  ), 0) OR p_version <> p_expected_version + 1 THEN
    RAISE EXCEPTION 'version_conflict';
  END IF;

  UPDATE public.company_identities ci
  SET tax_id = coalesce(p_tax_id, ci.tax_id),
      normalized_domain = coalesce(p_domain, ci.normalized_domain),
      normalized_name = coalesce(p_name, ci.normalized_name),
      updated_at = v_now
  WHERE ci.tenant_id = v_tenant_id AND ci.id = p_company_id;

  v_official_name := coalesce(p_profile_data->>'officialName', p_name);

  INSERT INTO public.company_profiles (
    tenant_id, id, version, official_name, data, analysis_report, created_at, updated_at
  ) VALUES (
    v_tenant_id, p_company_id, p_version, v_official_name,
    p_profile_data, p_analysis_report, v_now, v_now
  )
  ON CONFLICT (tenant_id, id, version) DO UPDATE SET
    official_name = excluded.official_name,
    data = excluded.data,
    analysis_report = excluded.analysis_report,
    updated_at = excluded.updated_at;

  IF p_diff_data IS NOT NULL THEN
    v_diff_id := coalesce(p_diff_data->>'id', p_company_id || '-v' || p_version);
    v_from_version := (p_diff_data->>'fromVersion')::integer;
    v_to_version := (p_diff_data->>'toVersion')::integer;

    INSERT INTO public.company_diffs (
      tenant_id, id, company_id, from_version, to_version, data, created_at
    ) VALUES (
      v_tenant_id, v_diff_id, p_company_id, v_from_version, v_to_version, p_diff_data, v_now
    )
    ON CONFLICT (tenant_id, id) DO UPDATE SET
      from_version = excluded.from_version,
      to_version = excluded.to_version,
      data = excluded.data;
  END IF;

  RETURN v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_research_quota(
  p_tenant_id uuid,
  p_user_id uuid,
  p_operation text,
  p_idempotency_key uuid,
  p_cost integer
)
RETURNS TABLE (
  allowed boolean,
  reservation_id uuid,
  remaining integer,
  reset_at timestamptz,
  duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_reservation public.research_quota_reservations%ROWTYPE;
  v_remaining integer;
  v_reservation_id uuid;
BEGIN
  PERFORM 1 FROM public.resolve_research_tenant(p_user_id, p_tenant_id);

  IF p_operation IS NULL OR btrim(p_operation) = '' OR p_idempotency_key IS NULL OR p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_quota_reservation';
  END IF;

  -- Serialize all reservations for a tenant. This makes duplicate requests
  -- observe the committed reservation before any quota counter is changed.
  SELECT * INTO v_tenant
  FROM public.tenants t
  WHERE t.id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant_membership_required';
  END IF;

  SELECT * INTO v_reservation
  FROM public.research_quota_reservations r
  WHERE r.tenant_id = p_tenant_id AND r.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_reservation.user_id <> p_user_id
       OR v_reservation.operation <> p_operation
       OR v_reservation.cost <> p_cost THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'idempotency_key_conflict';
    END IF;

    RETURN QUERY SELECT v_reservation.allowed, v_reservation.id,
      v_reservation.remaining, v_reservation.reset_at, true;
    RETURN;
  END IF;

  v_period_start := date_trunc('day', timezone('utc'::text, now())) AT TIME ZONE 'UTC';
  v_period_end := v_period_start + v_tenant.quota_period;

  INSERT INTO public.research_quota_periods (
    tenant_id, period_start, period_end, quota_limit, used
  ) VALUES (
    p_tenant_id, v_period_start, v_period_end, v_tenant.research_quota_limit, 0
  ) ON CONFLICT (tenant_id, period_start) DO NOTHING;

  UPDATE public.research_quota_periods qp
  SET used = qp.used + p_cost
  WHERE qp.tenant_id = p_tenant_id
    AND qp.period_start = v_period_start
    AND qp.used + p_cost <= qp.quota_limit
  RETURNING qp.quota_limit - qp.used INTO v_remaining;

  IF NOT FOUND THEN
    SELECT qp.quota_limit - qp.used, qp.period_end
    INTO v_remaining, v_period_end
    FROM public.research_quota_periods qp
    WHERE qp.tenant_id = p_tenant_id AND qp.period_start = v_period_start;

    v_reservation_id := gen_random_uuid();
    INSERT INTO public.research_quota_reservations (
      id, tenant_id, user_id, idempotency_key, operation, cost,
      period_start, allowed, remaining, reset_at
    ) VALUES (
      v_reservation_id, p_tenant_id, p_user_id, p_idempotency_key,
      p_operation, p_cost, v_period_start, false, v_remaining, v_period_end
    );

    RETURN QUERY SELECT false, v_reservation_id, v_remaining, v_period_end, false;
    RETURN;
  END IF;

  v_reservation_id := gen_random_uuid();
  INSERT INTO public.research_quota_reservations (
    id, tenant_id, user_id, idempotency_key, operation, cost,
    period_start, allowed, remaining, reset_at
  ) VALUES (
    v_reservation_id, p_tenant_id, p_user_id, p_idempotency_key,
    p_operation, p_cost, v_period_start, true, v_remaining, v_period_end
  );

  RETURN QUERY SELECT true, v_reservation_id, v_remaining, v_period_end, false;
END;
$$;

-- Revoke every legacy tenant-unaware cache RPC before granting v2 entry points.
REVOKE EXECUTE ON FUNCTION public.lookup_company_identities(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_company_identity(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.persist_research_snapshot(text, text, text, text, integer, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.resolve_research_tenant(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lookup_company_identities_v2(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_company_identity_v2(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_latest_research_snapshot_v2(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.persist_research_snapshot_v2(uuid, text, text, text, text, integer, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_research_quota(uuid, uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_research_tenant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lookup_company_identities_v2(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_company_identity_v2(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_latest_research_snapshot_v2(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_research_snapshot_v2(uuid, text, text, text, text, integer, integer, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_research_quota(uuid, uuid, text, uuid, integer) TO service_role;
