# GiveToMe – Expanded Financial Reports

## Report additions
- Expense category donut chart with percentage share and amount per category.
- Current liquidity overview: current balance per active account, share of positive balances, and period inflow/outflow/net movement per account.
- Financial health indicators: net saving rate, expense-to-income ratio, transaction count, and total current account balance.
- Top five expenses in the selected period.
- Cash-flow timeline comparing income and expenses.
- Consolidated statement-style activity list (up to 100 latest entries in the selected period), including transfers and source/destination accounts.
- CSV export remains scoped to the selected date range.

## Data safety
- No Prisma schema changes.
- No SQL migration or destructive database command is added.
- Existing Supabase records, recurring bill history, and legacy BillCheck data are not deleted or rewritten by this report change.
- Reports read transactions with `POSTED` status. Transfers are shown in account movement and the statement list, but excluded from income/expense totals to avoid double counting.

## Validation
- Inline frontend JavaScript passed `node --check`.
- Full `npm run build` could not be completed in the packaging environment because the installed `node_modules` is incomplete (`prisma: not found`). Run `npm ci` and `npm run build` in CI/Render before relying on deployment.
