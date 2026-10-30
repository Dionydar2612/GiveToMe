# GiveToMe – Tax Planning Report

## Added
- Thai personal income tax planning panel in Financial Reports.
- Editable tax year, annual assessable income, deductible expenses, total eligible allowances, and tax withheld.
- Optional helper to fill annual `INCOME` transaction totals from the selected tax year. This is only a starting figure; users must review taxability and completeness.
- Salary expense helper: 50% of salary income, capped at THB 100,000. Use only when eligible for the relevant income type.
- Progressive tax estimate using the Thai individual income tax brackets: 0–150,000 exempt; 150,001–300,000 5%; 300,001–500,000 10%; 500,001–750,000 15%; 750,001–1,000,000 20%; 1,000,001–2,000,000 25%; 2,000,001–5,000,000 30%; over 5,000,000 35%.
- Shows estimated tax, estimated amount still to prepare after withholding, possible overpayment, and a monthly saving guide for the current/future tax year.
- Tax-planning inputs are stored in browser localStorage on the current device; no tax profile or personal tax information is written to Supabase.
- Summary API now also returns `recordedIncome`, which sums only POSTED `INCOME` transactions (not refunds or transfers) to help prefill the calculator.

## Data safety
- No Prisma schema changes and no SQL migrations.
- No database records are deleted or rewritten.
- Existing transaction, account, recurring bill, payment history, and legacy BillCheck records are preserved.

## Important limitations
- The calculator is a planning estimate, not an official return or tax advice.
- It uses the progressive net-income method. Different income types may have different expense deductions, exemptions, and may require additional tax calculations (including the gross-income method in some cases).
- The prefilled app income is not automatically classified as taxable income. Review it against payslips, 50 Tawi withholding certificates, and all other income sources.
- The salary expense helper is 50%, capped at THB 100,000; use only for eligible employment/service income. Enter only deductions/allowances you can substantiate and are legally entitled to claim for the selected tax year.
- Confirm current-year rules and entitlements with the Thai Revenue Department before filing.

## Validation
- Inline browser JavaScript passed `node --check`.
- Full TypeScript build was not run in this packaging environment. Run `npm ci` then `npm run build` in CI/Render before deployment.

## Reference material
- Thai Revenue Department, Personal Income Tax: https://www.rd.go.th/english/6045.html
- PwC Thailand, Thai Tax 2025/26 booklet: https://www.pwc.com/th/en/tax/assets/thai-tax/2025-2026/thai-tax-booklet-2025-26.pdf
