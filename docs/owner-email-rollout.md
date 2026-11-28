# Owner email delivery rollout (not yet active)

Migration `0030_owner_email_outbox.sql` creates a private transactional queue. It enqueues new shop applications, review changes, subscription changes, payment review changes and seven-day expiry reminders. Existing applications are not backfilled. A resubmission to pending produces `under_review`; there is no separate initial-review state in the database. The periodic reminder scan includes current subscriptions expiring within seven days or expired in the last day. Permanent subscriptions are excluded. No pilot access or subscription is granted by email.

The worker in `supabase/functions/owner-email-dispatch` uses the shared branded templates, a private bearer secret, Supabase's service role and Brevo. Never send provider credentials to a browser. The worker reports counts, not recipient data. Only explicit Brevo 429 rejections retry (five attempts with five-minute backoff). Network errors, provider 5xx, expired claims, and interrupted finalization are `unknown` and must be investigated before retry to prevent duplicate messages. Other provider 4xx failures are marked failed. Brevo accepting a request does not prove delivery.

Before production enablement: apply and exercise migration in isolated QA, verify the bundled Edge Function and unauthorized invocation, use a controlled recipient, confirm Brevo's sender/IP settings, install a secret-backed scheduler with an operator-visible alert and kill switch, and test scheduling, expiry, renewal, provider failure and delivery. Enabling reminder scanning can notify existing subscription owners. Never rely on a permanently running scheduler or free-tier availability. Claims validate current state immediately before dispatch but cannot retract a message already handed to a provider if the status changes concurrently.

Inspect aggregate queue status, without printing recipient addresses:

```sql
select state, kind, count(*) from public.owner_email_outbox group by state, kind order by state, kind;
```

On incident, first disable the worker scheduler and revoke worker access. Investigate failed/unknown messages and Brevo delivery logs before any manual retry. Do not use a blanket update to resend unknown messages.
