# Research Gateway Worker

Web-API-only Cloudflare Worker for `POST /api/research`.

## Required secrets

Set these separately for staging and production:

```sh
npm exec -- wrangler secret put SUPABASE_API_KEY --env staging
npm exec -- wrangler secret put GATEWAY_SIGNING_KEY --env staging
```

Repeat with `--env production`. `SUPABASE_API_KEY` must be a server-side Supabase key authorized only for the membership and quota RPCs. Never expose it to clients.

## Required Supabase RPC contracts

- `resolve_research_tenant(p_user_id uuid, p_tenant_hint uuid DEFAULT NULL) RETURNS TABLE (tenant_id uuid)` returns exactly one row with `{ "tenant_id": "<uuid>" }`. A supplied hint must match the verified user's membership. Without a hint, exactly one membership is auto-selected; zero memberships produce `tenant_access_denied`, and multiple memberships produce `tenant_selection_required`. This contract is defined in `supabase/migrations/20260827000000_tenant_isolation_and_quota.sql` and must be applied before deploying the Worker.
- `reserve_research_quota(p_tenant_id uuid, p_user_id uuid, p_operation text, p_idempotency_key uuid, p_cost integer)` returns exactly one object/row with `{ "allowed": boolean, "reservation_id": "...", "remaining": number, "reset_at": "..." }`.

The Worker sends its server-side API key to these RPCs. The database functions must perform membership and atomic idempotent quota enforcement. Quota is not refunded by this Worker.

## Deployment guard

All committed origin and Supabase URLs are deliberate placeholders. The Worker returns `503`, and `npm run predeploy` is blocked by `scripts/deploy-guard.ts` until every placeholder is replaced.

## Internal signature

The origin receives `x-internal-tenant-id`, `x-internal-user-id`, `x-internal-request-id`, `x-internal-timestamp`, `x-internal-signature`, and `x-internal-key-id`. The signed canonical string is newline-separated:

```text
<timestamp>
<requestId>
<userId>
<tenantId>
POST
/api/research
<sha256 body digest>
<idempotency key>
```

The origin must reject timestamps outside the configured 60-second replay window and deduplicate request IDs/idempotency keys. A timestamp window alone does not prevent replay.
