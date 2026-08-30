# Research gateway delivery runbook

The Cloudflare Worker is the public research gateway. The existing `release.yml` workflow continues to publish the Node/Cloud Run origin image; the Worker deploy workflows are separate and manual.

## Package contract

`workers/research-gateway` owns its source, Wrangler configuration, generated bindings, tests, and lockfile. Root delivery automation expects these Worker scripts:

| Script | Expected behavior |
| --- | --- |
| `test` | Run Worker runtime tests without network credentials. |
| `typecheck` | Type-check Worker source. |
| `types:check` | Run `wrangler types --check` against committed generated bindings. |
| `deploy:dry-run` | Run a credential-free `wrangler deploy --dry-run`. |
| `check:startup` | Measure Worker startup and enforce Wrangler's startup gate. |

Deployment workflows invoke the Worker-local Wrangler binary with `npm exec --prefix workers/research-gateway -- wrangler deploy --env <name>`.

The Worker package should pin compatible versions of Wrangler, Workers types, Vitest, and `@cloudflare/vitest-pool-workers` in its own `package.json` and `package-lock.json`. Root commands delegate with `npm --prefix`; dependencies are not duplicated into the Next.js package.

CI activates the Worker checks as soon as `workers/research-gateway/package.json` exists. A committed Worker package must therefore include its lockfile and all scripts above.

## Environment contract

Keep non-secret values in each Wrangler environment and replace all example origins before deployment:

- `ORIGIN_URL`: staging or production Cloud Run origin URL.
- `SUPABASE_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`: environment-specific auth configuration.
- Membership is resolved through `resolve_research_tenant`; the database function must derive membership from the verified user and never trust a client tenant header.
- Quota is reserved through the atomic, idempotent `reserve_research_quota` RPC.
- `GATEWAY_KEY_ID`: identifier included with the current signing key.
- `REPLAY_WINDOW_SECONDS`: origin replay-window limit; keep it aligned with the origin verifier.
- `MAX_BODY_BYTES`, `ORIGIN_TIMEOUT_MS`, `SUPABASE_TIMEOUT_MS`, `QUOTA_OPERATION`, and `QUOTA_COST`: environment-specific gateway limits and quota inputs.

Store secret values with Wrangler or protected GitHub environment secrets, never in `.env.example`, Wrangler config, workflow inputs, or logs:

- Worker: restricted `SUPABASE_API_KEY` and `GATEWAY_SIGNING_KEY`.
- Origin: `GATEWAY_SIGNING_KEY_CURRENT` and, during rotation only, `GATEWAY_SIGNING_KEY_PREVIOUS`.
- GitHub `staging` and `production` environments: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Use a narrowly scoped Cloudflare API token. Add required reviewers to the GitHub `production` environment. Pull-request CI receives no Cloudflare or application secrets.

## Pre-deployment

1. Deploy the matching Node origin image and configure signature verification in the migration plan's dual-accept/observe mode.
2. Verify the Worker environment uses the correct origin, Supabase project, tenant-membership strategy, quota RPC, and signing key ID.
3. Synchronize the current signing key to the Worker and origin using their secret stores.
4. Run:

   ```bash
   npm ci
   npm ci --prefix workers/research-gateway
   npm run worker:check
   ```

5. Confirm the target origin readiness endpoint succeeds before exposing Worker traffic.

## Deploy

Use **Deploy research gateway (staging)** first. It accepts a branch, tag, or commit in the `ref` input. After smoke testing that exact revision, use **Deploy research gateway (production)** with its full 40-character commit SHA. Both workflows use GitHub environment-scoped credentials and do not run for pull requests.

The workflows deploy only the Worker and do not replace `.github/workflows/release.yml` or its Cloud Run image publication behavior.

## Smoke test

The script always verifies that an unauthenticated request is rejected. With a short-lived valid staging JWT, it also verifies an SSE content type, reads the first streamed chunk, and cancels the client stream. It deliberately sends forged `x-internal-*` headers so the gateway's header sanitization path is exercised.

```bash
RESEARCH_GATEWAY_URL=https://staging-gateway.example.workers.dev \
  npm run smoke:gateway

RESEARCH_GATEWAY_URL=https://staging-gateway.example.workers.dev \
RESEARCH_GATEWAY_SMOKE_JWT='<short-lived Supabase user JWT>' \
RESEARCH_GATEWAY_SMOKE_QUERY='OpenAI' \
  npm run smoke:gateway
```

Do not put JWTs on the command line in shared terminals or CI logs. For repeatable staging validation, inject the JWT through a protected environment secret. The authenticated check consumes quota by design.

The automated script does not force quota exhaustion, cross-tenant cache access, or origin failure because those checks mutate shared state or require infrastructure controls. Verify them manually in staging with dedicated tenants and test quotas:

1. Repeat the same idempotency key through the gateway and confirm quota is charged once.
2. Exhaust a dedicated tenant's quota; confirm `429` and no origin invocation.
3. Attempt cache select/refresh using another tenant's identifiers; confirm no data is returned or mutated.
4. Make the staging origin unavailable; confirm the gateway's documented failure status and no buffered SSE body.
5. Check Worker and origin logs for the same request ID and confirm tokens, signing keys, and authorization headers are absent.

## Rollback and key rotation

Rollback the Worker with Cloudflare's version rollback, then rerun the smoke test. Do not roll back tenant-isolation migrations after new tenant-scoped data has been written.

For signing-key rotation:

1. Add the new key to the origin as current while retaining the old key as previous.
2. Set the Worker current key and key ID to the new values.
3. Deploy and smoke test staging, then production.
4. Remove the previous key from the origin after the replay window and rollback window close.

If rollback requires the prior Worker version, keep the previous origin key accepted until rollback is no longer possible.
