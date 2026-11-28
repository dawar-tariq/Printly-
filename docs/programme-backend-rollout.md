# Affiliate and owner referral backend rollout

## Status
The first attribution tables in `0033_program_attribution_foundation.sql` are deployed **only to the isolated QA database** (migration `program_attribution_foundation`). They are empty infrastructure: no signup or rewards are wired to them. The affiliate and referral screens remain gated previews. No live programme claims or production database migration should be enabled from this foundation alone.

## Agreed rules
- Affiliates sign up with email; 30% by default on every approved subscription payment, including renewals. Admin can manage affiliates, rates, thresholds and incentives. Payments are manual outside Printly using securely provided bank or UPI/QR details.
- Owner referrals and affiliate attribution can coexist. A distinct referred shop qualifies when approved and its owner has signed in. At 10 qualified shops grant six months, at 20 add another six. At 15, unlock 10% of each referred shop's first approved subscription payment, including earlier referrals. Payouts are reviewed and recorded manually.
- Email-only owner login; Google affiliate login and two-factor authentication are future work.

## Integration findings
- Both QA and production have `create_shop_application` and `review_subscription_purchase`; neither currently has programme functions. The signup RPC currently accepts no attribution arguments. The approval RPC locks shop and purchase and must remain safe during retries/concurrent approvals.
- `start_subscription_purchase_with_offer` can create an automatically approved zero-price purchase; this is not the same path as a manual paid approval. Accounting must explicitly define and test how a free approved purchase affects the phrase “first approved subscription payment” before launch. Never award money against zero amounts.
- The existing signup route creates an Auth user and then invokes the shop-creation RPC; Auth and Postgres are not one atomic transaction. Attribution must be bound in the shop creation transaction, with safe cleanup/retries if auth creation or application creation fails. Do not trust client-supplied referrer identity, rates, qualification or payout totals.
- Qualification needs a reliable server-verified owner sign-in event, independently of subscription entitlement. The exact signup/login/auth flow and email verification behaviour require testing; existing shop signup uses auto-confirmation, which does not establish control of the email address.

## Required before activation
1. Define link/cookie persistence, expiry and conflict policy separately for each programme, self-referral/duplicate/fraud rules and evidence. Resolve free-purchase treatment, rate-change timing, chargeback/reversal policy, threshold defaults and effective launch date before announcing contractual terms.
2. Add server-authenticated affiliate registration, login and authorization; secure account recovery, rate limiting and abuse controls. Verify users can only access their own information; admin endpoints must independently enforce admin authorization. Avoid exposing bank/UPI data in logs or general queries; define encryption, retention and access auditing before implementing storage.
3. Bind both validated codes to shop signup transactionally; no reassignment on retries. Test missing, invalid, tampered, competing and self-referral codes and simultaneous signup requests.
4. Implement durable qualification events and one-time milestone grants with unique constraints and locking. Entitlement changes and reward records must commit together, preserve existing subscriptions and permanent access, and support retries without duplicated months. Include approval-before-login and login-before-approval tests.
5. Implement an append-only commission ledger based on approved actual payment snapshots, unique per programme and purchase; support independent rewards, retroactive owner commission at milestone 15, concurrent approval/unlock and idempotent reconciliation. Establish explicit adjustment/reversal flows rather than editing historical entries.
6. Build secure payout details, threshold accounting, admin review and manual payment recording with immutable audit events and protection against duplicate or concurrent payouts. Never transfer funds automatically.
7. Add owner, affiliate and admin real-data interfaces and disable illustrative figures. Test authorization, RLS, transaction failure, parallel requests, renewals, free offers, attribution fraud and end-to-end flows on QA. Perform an independent security/financial review and backup/rollback rehearsal before production migrations and activation.

The QA foundation uses RLS with no client grants or policies; trusted service-role access is not itself sufficient authorization. Future privileged RPCs must authenticate callers at the server boundary, validate actor ownership/admin role, revoke public execution, and use a fixed search path. No production programme data is backfilled by this work.
