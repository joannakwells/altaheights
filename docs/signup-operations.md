# Signup reliability upgrade — deployment pending

This branch is not ready to merge until its infrastructure is configured and the preview has passed live tests. Production currently uses the repaired anonymous JSONP form.

## Design

The existing form posts JSON to `/api/signup`. The Vercel function validates input, applies a persistent per-IP rate limit (60/hour), saves the email and name to Neon PostgreSQL, and attempts Google Sheet delivery. It acknowledges success only after durable storage. Google failures leave a pending database row; `/api/signup-maintenance` retries due rows under a lease, verifies database writes and Google connectivity, and reports overdue deliveries. Failed requests retain form inputs for retry.

Database email uniqueness makes browser retries idempotent. Google delivery is at least once: the existing Apps Script checks for duplicate addresses before appending. Its check and append are not transactional; a rare ambiguous timeout or overlapping execution could still duplicate a Sheet row. The database remains authoritative. Do not describe Sheet synchronization as exactly once.

The fixed diagnostic address `signup-diagnostic@example.invalid` already exists in the Sheet. Maintenance reuses it to verify Google responds without creating a fresh row every run. It checks both database writes and Google responses, but does not independently read the Sheet back. Complete browser-to-Sheet verification is required before launch.

## Required configuration

1. Connect a Neon database to the **altaheights** Vercel project (repository root, not the shop-headless project). Use separate preview and production databases. Review the provider plan and costs before creating a paid resource.
2. Run `db/signup.sql` once in each database. Configure a dedicated runtime database role with SELECT/INSERT/UPDATE/DELETE on these tables. Do not put database credentials in GitHub or client code.
3. Set server-side Vercel environment variables:
   - `DATABASE_URL`: runtime-role database connection string.
   - `SIGNUP_SHEET_URL`: existing public Apps Script `/exec` endpoint from the production site. For preview tests, use a test Sheet deployment, or explicitly use only the existing diagnostic address against production.
   - `SIGNUP_RATE_SECRET`: cryptographically random secret, at least 32 characters.
   - `SIGNUP_MONITOR_SECRET`: different random secret, at least 32 characters.
   - `SIGNUP_ALLOWED_ORIGINS`: exact comma-separated website origins. Production defaults cover www and apex. Add the exact preview origin only in its preview environment.
4. Configure an independent uptime monitor to POST to `/api/signup-maintenance` every 5 minutes with `Authorization: Bearer <SIGNUP_MONITOR_SECRET>`. Expect HTTP 200 and JSON `ok: true`; use a 65-second request timeout. It performs retries as well as health checks. Configure failure and recovery email delivery to the owner-designated address, and verify receipt with a deliberate test failure. Keep the authentication token in the monitor's secret storage.
5. Add a browser synthetic check for the public form (desktop Chromium and mobile WebKit) that reuses the designated diagnostic address, verifies a success message and confirms its database/Sheet record. Configure alerts for broken browser flow independently of the backend monitor. Test Google-signed-in and signed-out sessions manually before rollout.
6. The GitHub manual workflow is a troubleshooting aid, not the primary scheduler. Set its `SIGNUP_MONITOR_SECRET` repository secret if using it. Scheduled GitHub Actions can be delayed or disabled after repository inactivity; do not rely on them as the only availability monitor.

No monitoring service, alert delivery, database, or new production endpoint is configured by committing these files alone. The alert recipient has been supplied in the task; configure it in the monitoring service rather than hardcoding it into a public repository.

## Launch checks

- `npm ci && npm test` passes. Tests use actual embedded PostgreSQL (PGlite), plus mocked Google responses and DOM form lifecycle checks.
- Preview deployment serves all existing static pages and the Node API routes; verify no change to the separate shop deployment.
- Submit the diagnostic address through the preview form and confirm its database row and Sheet presence.
- In the isolated preview environment, break Google delivery: signup still succeeds, the database row remains pending, and restoring Google plus maintenance delivers it.
- Break preview database access: the form shows an error and preserves inputs, never a success message.
- Verify duplicate requests, concurrent retries, mobile browser behavior, and timeout handling.
- Verify the independent monitor and actual email receipt, including a failure of the whole website.
- Merge only after the above checks; verify production again after Vercel deploys. Require the signup test check for future pull requests in GitHub branch settings.

## Operations

Logs contain event names and random request IDs, never subscriber names/emails, IPs or provider error strings. Inspect `signup_storage_failed`, `signup_sync_deferred`, and `signup_health_failed` in Vercel. The private database holds pending deliveries and retry counts. A pending row older than 15 minutes makes maintenance unhealthy. Investigate sustained backlog, database limits, Google quotas/permissions, and monitor silence.

Confirm database backups/restore retention in the chosen plan, set quota/spend alerts, and agree on a subscriber retention/deletion process. Deleting a subscriber must remove both the Sheet and database entry to avoid re-syncing it. Database outages still prevent signup acceptance; this design tolerates Google outages, not every possible infrastructure outage.

Rollback the website through Vercel to the previous production deployment if needed. Keep the database and maintenance running until all accepted pending signups have reached the Sheet; reverting the website does not erase or deliver queued records.
