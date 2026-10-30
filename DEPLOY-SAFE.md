# GiveToMe — Safe deploy preserving existing Supabase data

## What changed

- Removed `prisma db push` from application startup. The previous command tried to drop legacy `BillTemplate`, `SalarySetting`, and `BillOccurrence.templateId`, then aborted because those objects contain data.
- Added one idempotent, additive SQL migration that creates only the new `RecurringBill` and `BillCheck` tables/indexes if missing.
- Legacy tables and columns are deliberately left untouched. No `DROP`, `TRUNCATE`, destructive `ALTER`, or row deletion is included.
- Updated the Render Blueprint so it asks for `DATABASE_URL` rather than silently provisioning/using a different Render PostgreSQL database. Keep the existing Supabase URL.

## Before deploying (required safety step)

1. In Supabase Dashboard, select the existing project and create/download a database backup (or use `pg_dump -Fc`). Do not run the old `npm start` while the old package version is deployed if it still contains `prisma db push`.
2. In Render → GiveToMe → Environment, verify `DATABASE_URL` still points to the same Supabase project/pooler. Do not replace it with a new database URL. Keep the existing `SESSION_SECRET`; changing it signs out existing sessions but does not delete user data.
3. Deploy this version. Build runs `prisma generate && tsc`; start runs only the additive SQL and then the server.
4. Check `/health`, log in with an existing account, and verify accounts, transactions, recurring bills, salary/budget/goal data as applicable.

## Why the old data remains

The new runtime schema no longer maps the old `BillTemplate`, `SalarySetting`, and `BillOccurrence.templateId` objects. PostgreSQL allows those unused objects to remain in place. The safe migration only adds `RecurringBill` and `BillCheck` if they do not exist. It does not attempt to convert legacy rows automatically because the exact legacy column definitions and business mapping must be verified against the live database first.

## Rollback

If the new app has an issue, redeploy the previous application code but **do not restore an old dump over the live database**. The added tables are harmless to the old code. Do not run `prisma db push` from either version. Keep the backup securely; it contains private financial data.

## Local checks

```bash
npm ci
npm test
npm run build
```

For local startup, set `DATABASE_URL` to a disposable/test database first, then run `npm start`. The additive SQL is safe to run repeatedly.
