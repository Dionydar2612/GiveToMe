# Build fix: TS2322 recurring bill payment

The recurring-bill payment endpoint now explicitly rejects payment with HTTP 400 when neither the payment request nor the recurring bill has a selected account. This narrows `accountId` to a non-null string before account ownership validation and before creating the transaction/payment rows.

No Prisma schema, migration, or existing database data was changed for this fix.

## Deploy
1. Replace the repository contents with this project (or apply the `src/server.ts` change).
2. Commit and push to `main`.
3. Deploy on Render using the existing environment variables and existing Supabase `DATABASE_URL`.
4. Test paying a recurring bill with a selected account. If no account is configured, the API returns HTTP 400 with a Thai prompt to select an account rather than crashing at build time.
