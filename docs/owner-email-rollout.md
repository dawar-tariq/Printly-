# Owner email delivery rollout

Migration `0030_owner_email_outbox.sql` creates a private transactional queue. It enqueues new shop applications, review changes, subscription changes, payment review changes and seven-day expiry reminders. Existing applications are not backfilled. A resubmission to pending produces `under_review`; there is no separate initial-review state in the database. The periodic reminder scan includes current subscriptions expiring within seven days or expired in the last day. Permanent subscriptions are excluded. No pilot access or subscription is granted by email.

The worker in `supabase/functions/owner-email-dispatch` uses the shared branded templates, a private bearer secret, Supabase's service role and Brevo. Never send provider credentials to a browser. The worker reports counts, not recipient data. Only explicit Brevo 429 rejections retry (five attempts with five-minute backoff). Network errors, provider 5xx, expired claims, and interrupted finalization are `unknown` and must be investigated before retry to prevent duplicate messages. Other provider 4xx failures are marked failed. Brevo accepting a request does not prove delivery.

QA: the bundled worker rejected unauthenticated requests and accepted three controlled signup/review messages; a temporary scheduler processed a subscription change and an expiry warning. The synthetic test fixture, QA scheduler and QA copies of secrets were removed. These checks confirmed provider acceptance, not inbox delivery or all production paths.

Production: migration 0030, the bundled Edge Function, and `printly-owner-email-dispatch` are installed. The five-minute scheduler obtains its bearer secret from Vault; `scripts/owner-email-scheduler.sql` contains its definition and emergency stop. Cron runs are recorded in `cron.job_run_details`. There is currently no independent automatic alert for failed runs or failed/unknown queue entries: operators must monitor both. The first production scheduler run succeeded and Brevo accepted a controlled welcome email for the owner. Reminder scanning may notify existing subscription owners. Never rely on a permanently running scheduler or free-tier availability. Claims validate current state immediately before dispatch but cannot retract a message already handed to a provider if the status changes concurrently.

Inspect aggregate queue status, without printing recipient addresses:

```sql
select state, kind, count(*) from public.owner_email_outbox group by state, kind order by state, kind;
```

On incident, first disable the worker scheduler and revoke worker access. Investigate failed/unknown messages and Brevo delivery logs before any manual retry. Do not use a blanket update to resend unknown messages.
