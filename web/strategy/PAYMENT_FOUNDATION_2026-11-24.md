# Payment foundation (2026-11-24)

This change intentionally leaves paymentsEnabled=false and does not accept payments.
Current BCC merchant onboarding is pending. No merchant credentials, payment links,
test transaction or card data are stored here.

- Server-side package catalogue is unchanged. Public tokens are not OpenAI API tokens.
- Orders snapshot the package, amount in KZT minor units and internal credits.
- Only the signed-in account can view its order history (latest 100).
- Settlement is a server-only synchronous operation, not an HTTP endpoint.
- Duplicate provider transaction references and conflicting amounts are rejected.
- The order and balance are saved together in the existing encrypted store.
- The current store assumes a single writer process. Verify deployment before enabling payments.

## Remaining provider work
1. Obtain official BCC merchant API documentation, credentials and test environment.
2. Implement provider initiation, verified capture/status reconciliation, callback authentication,
   and allowlisted checkout redirects. Never credit on browser return or screenshot.
3. Add authenticated checkout creation with rate limits, per-order idempotency, and history UI.
4. Define timeout/cancel/refund/dispute and reconciliation policy; implement fiscal receipts.
5. Verify offer/privacy terms, unit economics and production backup/restore.
6. Run end-to-end sandbox tests (successful, failed, forged, duplicate, delayed payments);
   then enable payments explicitly. Do not expose the settlement function to public routes.
