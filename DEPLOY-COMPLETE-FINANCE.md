# GiveToMe – Financial reports and period selector update

## What is included
- Report period selector: month, year, week (Monday–Sunday), day, and custom date range.
- Historical month selection through a month picker and historical year selection through a year dropdown (current year back 30 years).
- One-click return to the current period.
- All report totals, account movement, category breakdown, top expenses, cash-flow chart, statement list, and CSV export follow the selected range.
- The tax-planning panel is retained from the preceding package. Tax inputs remain in this browser/device local storage and are not sent to Supabase.
- Existing accounts, transactions, recurring bills, payment history, and report logic are retained.

## Database safety
- This report-period update introduces no Prisma schema changes and no new SQL migration.
- It does not delete, rewrite, or reset Supabase rows.
- Existing additive migrations for recurring bills remain in the project. They are not destructive; do not replace the existing Supabase `DATABASE_URL`.
- Do not run `prisma db push --accept-data-loss`, `DROP`, `TRUNCATE`, or reset commands.

## Deploy on Render
1. Download a backup of the existing Supabase database before deploying.
2. In Render, keep the existing `DATABASE_URL` and `SESSION_SECRET` values unchanged.
3. Upload/push the complete project and deploy using the existing service.
4. Build command: `npm ci && npm run build` (or keep the existing Render build command if it already runs these steps).
5. Start command: `npm start`.
6. After deploy, open Reports and test month/year/week/day/custom range, historical periods, current-period reset, and CSV export.
7. Sign in using the existing account and verify account balances and transaction history.

## Validation performed in packaging environment
- Inline browser JavaScript passed `node --check`.
- Full test/build could not be run because dependencies are not installed in this packaging environment (`vitest`/Prisma CLI unavailable). Run `npm ci`, `npm test`, and `npm run build` in CI or locally before production deployment.

## Scope note
This update completes the historical reporting controls and retains recurring bills and tax planning. Budgets, debts, investments/assets, and savings-goal management still need dedicated screens and workflows; this package does not claim those modules are implemented yet.
