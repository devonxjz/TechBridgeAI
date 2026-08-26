-- ═══════════════════════════════════════════════════════
-- PartnerIQ — Research Cache Migration
-- ═══════════════════════════════════════════════════════

-- 1. Table for Canonical Company Identities
CREATE TABLE IF NOT EXISTS public.company_identities (
  id TEXT PRIMARY KEY,
  tax_id TEXT,
  normalized_domain TEXT,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_identities_tax_id
  ON public.company_identities (tax_id)
  WHERE tax_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_identities_domain
  ON public.company_identities (normalized_domain);
CREATE INDEX IF NOT EXISTS idx_company_identities_name
  ON public.company_identities (normalized_name);

-- 2. Add analysis_report column and complete profile index
ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS analysis_report JSONB;

CREATE INDEX IF NOT EXISTS idx_company_profiles_complete
  ON public.company_profiles (id, version DESC)
  WHERE analysis_report IS NOT NULL;

-- 3. Backfill identities from existing distinct company_profiles if any
INSERT INTO public.company_identities (id, tax_id, normalized_domain, normalized_name, created_at, updated_at)
SELECT DISTINCT ON (cp.id)
  cp.id,
  CASE
    WHEN (cp.data->>'taxId') ~ '^\d{10}(\d{3})?$' THEN cp.data->>'taxId'
    ELSE NULL
  END AS tax_id,
  CASE
    WHEN cp.data->>'website' IS NOT NULL AND cp.data->>'website' <> '' THEN
      regexp_replace(
        regexp_replace(
          lower(split_part(split_part(split_part(cp.data->>'website', '://', 2), '/', 1), ':', 1)),
          '\.$', ''
        ),
        '^www\.', ''
      )
    ELSE NULL
  END AS normalized_domain,
  lower(trim(regexp_replace(cp.official_name, '\s+', ' ', 'g'))) AS normalized_name,
  cp.created_at,
  cp.updated_at
FROM public.company_profiles cp
ORDER BY cp.id, cp.version DESC
ON CONFLICT (id) DO NOTHING;

-- 4. Add foreign key constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_profiles_identity_fk'
  ) THEN
    ALTER TABLE public.company_profiles
      ADD CONSTRAINT company_profiles_identity_fk
      FOREIGN KEY (id) REFERENCES public.company_identities(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_diffs_identity_fk'
  ) THEN
    ALTER TABLE public.company_diffs
      ADD CONSTRAINT company_diffs_identity_fk
      FOREIGN KEY (company_id) REFERENCES public.company_identities(id);
  END IF;
END $$;

-- 5. RLS & Server-Only Privileges
DROP POLICY IF EXISTS "Allow anon read/write company_profiles" ON public.company_profiles;
DROP POLICY IF EXISTS "Allow anon read/write company_diffs" ON public.company_diffs;

ALTER TABLE public.company_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_diffs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.company_identities FROM anon, authenticated;
REVOKE ALL ON public.company_profiles FROM anon, authenticated;
REVOKE ALL ON public.company_diffs FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.company_identities TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.company_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.company_diffs TO service_role;

-- 6. Read-only Lookup RPC
CREATE OR REPLACE FUNCTION public.lookup_company_identities(
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
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT DISTINCT
    ci.id,
    ci.tax_id,
    ci.normalized_domain,
    ci.normalized_name,
    ci.created_at,
    ci.updated_at
  FROM public.company_identities ci
  WHERE (p_tax_id IS NOT NULL AND ci.tax_id = p_tax_id)
     OR (p_domain IS NOT NULL AND ci.normalized_domain = p_domain)
     OR (p_name IS NOT NULL AND ci.normalized_name = p_name)
  ORDER BY ci.id;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_company_identities(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_company_identities(text, text, text) TO service_role;

-- 7. Transactional Resolve/Create Identity RPC
CREATE OR REPLACE FUNCTION public.resolve_company_identity(
  p_tax_id text,
  p_domain text,
  p_name text,
  p_candidate_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  resolved_id text;
  tax_owner_id text;
BEGIN
  -- Detect conflict between tax ID and domain if both provided
  IF p_tax_id IS NOT NULL AND p_domain IS NOT NULL THEN
    SELECT id INTO tax_owner_id
    FROM public.company_identities
    WHERE tax_id = p_tax_id;

    IF tax_owner_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.company_identities
        WHERE normalized_domain = p_domain
          AND id <> tax_owner_id
      ) AND NOT EXISTS (
        SELECT 1 FROM public.company_identities
        WHERE normalized_domain = p_domain
          AND id = tax_owner_id
      ) THEN
        RAISE EXCEPTION 'identity_conflict';
      END IF;
    END IF;
  END IF;

  IF p_tax_id IS NOT NULL THEN
    INSERT INTO public.company_identities (
      id, tax_id, normalized_domain, normalized_name
    ) VALUES (
      p_candidate_id, p_tax_id, p_domain, p_name
    ) ON CONFLICT (tax_id) WHERE tax_id IS NOT NULL DO NOTHING;

    SELECT id INTO resolved_id
    FROM public.company_identities
    WHERE tax_id = p_tax_id;
  ELSIF p_domain IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_domain));

    SELECT id INTO resolved_id
    FROM public.company_identities
    WHERE normalized_domain = p_domain
      AND normalized_name = p_name
    ORDER BY id
    LIMIT 1;

    IF resolved_id IS NULL THEN
      INSERT INTO public.company_identities (
        id, normalized_domain, normalized_name
      ) VALUES (
        p_candidate_id, p_domain, p_name
      ) RETURNING id INTO resolved_id;
    END IF;
  ELSE
    INSERT INTO public.company_identities (id, normalized_name)
    VALUES (p_candidate_id, p_name)
    RETURNING id INTO resolved_id;
  END IF;

  RETURN resolved_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_company_identity(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_company_identity(text, text, text, text) TO service_role;

-- 8. Atomic Persist Research Snapshot RPC
CREATE OR REPLACE FUNCTION public.persist_research_snapshot(
  p_company_id text,
  p_tax_id text,
  p_domain text,
  p_name text,
  p_version integer,
  p_profile_data jsonb,
  p_analysis_report jsonb,
  p_diff_data jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := timezone('utc'::text, now());
  v_official_name text;
  v_diff_id text;
  v_from_version integer;
  v_to_version integer;
BEGIN
  -- 1. Lock the target company_identities row
  PERFORM 1
  FROM public.company_identities
  WHERE id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'identity_not_found';
  END IF;

  -- 2. Recheck tax_id conflict against other identities
  IF p_tax_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.company_identities
      WHERE tax_id = p_tax_id AND id <> p_company_id
    ) THEN
      RAISE EXCEPTION 'identity_conflict';
    END IF;
  END IF;

  -- 3. Update target identity metadata
  UPDATE public.company_identities
  SET
    tax_id = COALESCE(p_tax_id, tax_id),
    normalized_domain = COALESCE(p_domain, normalized_domain),
    normalized_name = COALESCE(p_name, normalized_name),
    updated_at = v_now
  WHERE id = p_company_id;

  v_official_name := COALESCE(p_profile_data->>'officialName', p_name);

  -- 4. Upsert company_profiles
  INSERT INTO public.company_profiles (
    id,
    version,
    official_name,
    data,
    analysis_report,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    p_version,
    v_official_name,
    p_profile_data,
    p_analysis_report,
    v_now,
    v_now
  )
  ON CONFLICT (id, version) DO UPDATE SET
    official_name = EXCLUDED.official_name,
    data = EXCLUDED.data,
    analysis_report = EXCLUDED.analysis_report,
    updated_at = EXCLUDED.updated_at;

  -- 5. Upsert diff if provided
  IF p_diff_data IS NOT NULL THEN
    v_diff_id := COALESCE(p_diff_data->>'id', p_company_id || '-v' || p_version);
    v_from_version := (p_diff_data->>'fromVersion')::integer;
    v_to_version := (p_diff_data->>'toVersion')::integer;

    INSERT INTO public.company_diffs (
      id,
      company_id,
      from_version,
      to_version,
      data,
      created_at
    ) VALUES (
      v_diff_id,
      p_company_id,
      v_from_version,
      v_to_version,
      p_diff_data,
      v_now
    )
    ON CONFLICT (id) DO UPDATE SET
      from_version = EXCLUDED.from_version,
      to_version = EXCLUDED.to_version,
      data = EXCLUDED.data;
  END IF;

  RETURN v_now;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_research_snapshot(text, text, text, text, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_research_snapshot(text, text, text, text, integer, jsonb, jsonb, jsonb) TO service_role;
