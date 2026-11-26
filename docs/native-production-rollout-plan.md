# Printly 2.1.0: phone testing and production rollout plan

**This is a plan, not authorization to change production, sign an APK, send another notification, enable a scheduler or publish a release.** Each of those actions needs a separate, specific approval. Do not share passwords, service-account keys, tokens or private customer data in chat, Git or CI logs.

## Current evidence and limits

- The separately packaged, debug-signed **Printly Isolated Test** app (2.1.0, code 5) is installed on the user's phone. The user reports it works for ordinary use and confirmed that one separately approved managed v2 test notification appeared. FCM acceptance, the app's display receipt and the user's observation are distinct pieces of evidence; they do not guarantee future delivery or validate every notification feature.
- The matching management server and migration `0027` are deployed only in isolated QA. The general QA worker is disabled and its claim privileges are revoked. The one-shot test route and helper were removed; the test record was retained. No scheduler was enabled by these tests.
- A targeted API 35 emulator recheck passed the first-open notification-permission flow with the offline guard intact. The combined Android CI rerun is being checked separately. Neither an emulator nor the debug-signed QA package proves a production-signed upgrade works.
- The production-package 2.1.0 candidate has **not** been signed with the production release key or published. The older code-4/2.0.1 signed draft is not the current 2.1.0 candidate.
- The operator reported separately restore-tested production database and uploaded-file backups; they have not been independently inspected here. A synthetic local restore is not proof of hosted recoverability.
- A previous read-only production inventory found migration history through `0021` and no native-push or managed notification/release schemas. It also found `orders` in the Realtime publication with RLS enabled, unlike an earlier snapshot. Recheck the current state and investigate the difference; table membership and RLS being enabled do not prove cross-shop isolation.

## Phone testing that can start in isolated QA

Use the **existing** Printly Isolated Test app and its previously provided private QA login. Keep all names, orders, files and references synthetic; never make a real payment or enter real customer information. Do not remove or replace an existing production app. Do not post credentials, private data or device identifiers in chat.

1. Open the app and check that it is labelled as the isolated test. Browse **Home**, **Orders** and **More**; open and return from a synthetic order and check refresh/navigation.
2. Check inventory, reports and settings using synthetic information. Prefer viewing first; make only deliberate, reversible changes to synthetic test data. For payment screens, do not open a payment app or transfer money.
3. If the previously received test notification is still visible, tap it and check that it opens the app's Home screen. This does not require sending a new notification. If it is gone, do not create another send without approval.
4. Try a brief offline/reconnect cycle and check that the app shows an understandable state and refreshes after reconnection. Record the screen and steps for any issue, but redact private information.
5. **More → Check for app updates** is expected to find no release in isolated QA. The installer and a signed upgrade still need a separately designed test fixture.

The owner app is not the admin console. The Notifications & Updates console is a web admin feature; test it with an authorized **synthetic staging admin**, not the QA owner account. Initially verify access, drafts, templates, audience estimates and history without queuing, scheduling, publishing or enabling delivery. Provisioning an account, changing staging records or sending additional alerts requires an appropriately scoped decision.

## Gate A — finish readiness without live changes

- [ ] Run the combined Android CI suite from the exact reviewed branch commit; distinguish its result from the earlier targeted API 35 test. Review failures rather than bypassing the disposable-emulator or offline safeguards.
- [ ] Review the exact clean server, Android source, migrations and lockfiles. This checkout contains unrelated dirty work; never deploy or sign the whole worktree. Do not automatically include unrelated migrations `0022`–`0024`.
- [ ] Confirm a current database **and uploaded-file** backup, retention, consistency, restore target and named operator. Perform or review a restore in a separate environment and agree on recovery time and data-loss tolerance. The available connector cannot independently establish a hosted backup or perform a restore.
- [ ] Recheck production migration history, table/RPC ownership and grants, `orders` Realtime publication, RLS and expected cross-shop/anonymous access. Plan a non-invasive security review; do not use real customer rows as test fixtures.
- [ ] Agree on log/audit retention, monitoring ownership and capacity: claims have a shared 120-per-minute fixed-window ceiling, queue/retry actions share a 10-per-hour ceiling, and the proposed worker claims at most 30 per invocation. Durable audit and delivery logs have no automatic purge.

## Gate B — independently approved production database and server rollout

1. Agree on a maintenance window and a **compatible** rollback; pause any existing scheduler and keep delivery disabled. In-flight FCM messages cannot be recalled. Announcements or maintenance changes can queue work even when the worker is paused, so coordinate them.
2. Reconcile the actual production schema and review the ordered candidate migrations `0025_order_live_updates.sql`, `0026_native_order_push.sql` and `0027_native_notification_management.sql`, with their dependencies. Staging already has these and its alignment fix—do **not** reapply them there. Confirm the checked-in `0026` matches the intended corrected definition; do not assume staging's extra alignment migration should be replayed on production.
3. Before applying anything, rehearse the exact reviewed migration/restore sequence on a disposable copy and agree on how to handle queued work. Production database application is a separate approval. `0027` grants some service RPCs during installation: if claim privileges are being used as a stop control, the reviewed migration/ACL plan must account for those grants and verify the actual post-migration state.
4. Only after the compatible database is ready and a separate deployment approval is given, deploy the matching clean server with the push worker and managed release feed disabled. Verify admin authorization, legacy app behavior, PostgREST schema cache, RLS, source-trigger effects, worker stop controls and audit logs. A disabled worker does not imply an empty queue.
5. Do not turn on delivery, install/enable a recurring scheduler, restore blocked claim grants, or send a test merely because the server is deployed. Each requires separate approval, an identified consenting recipient and a monitored rollback/stop procedure.

## Gate C — separately approved signing and phone pilot

- [ ] Review the exact code-5/2.1.0 commit, dependencies and protected signing workflow. The existing checked-in request authorizes code 4 only; it does not authorize this build. A protected environment reviewer must approve the exact new request. No passwords or signing keys are to be shared in chat.
- [ ] After separate authorization, create an **unpublished** signed review build; do not publish a GitHub release or activate the app-download feed. Independently inspect downloaded bytes, package, version, hash and signer against a separately trusted release-certificate fingerprint.
- [ ] Decide explicitly whether the pilot may contact the **real production backend** and what synthetic account/data it may use. The production-package build is configured for the live site; it is not the isolated QA app. Never use real payments or customer data as test fixtures. A private draft or private transfer is not public distribution.
- [ ] On an agreed device, test fresh install and upgrade over a matching, independently verified existing production signature/version. Do not uninstall a real owner's app to work around a signing mismatch. Test installer permission, interruption, wrong hash/signer/version, offline behavior, and rollback/unpublish recovery.
- [ ] Test sign-in/session expiry, shop isolation, orders, inventory, reports and safe settings with the agreed synthetic pilot. A production notification test requires a **separate** approval specifying recipient, content, environment and at-most-one/uncertain-result handling.

## Gate D — separately approved notification and release activation

- [ ] Provision the **production** Firebase identity and private worker credentials only in the intended secret store, with least privilege and rotation. Never copy QA or production credentials across environments.
- [ ] Review consent, audiences and all pending/expired work; test a narrowly scoped approved pilot before any broad campaign. Schedule only after volume, monitoring and stop controls are agreed. A user may revoke consent or membership while a message is in flight.
- [ ] Verify the exact public release asset and its digest/signer independently before separately authorizing publication and managed-feed activation. A public GitHub release asset is downloadable by anyone with the URL. Keep mandatory updates off until cached-offline recovery and unpublish have been tested.
- [ ] Monitor job execution, queue age, FCM acceptance, unconfirmed leases, display-receipt gaps and log growth without logging FIDs or secrets. Acceptance or a display receipt does not mean a person read the notice.

**Stop/rollback:** disable the approved scheduler and worker, verify claim/queue controls, and investigate pending work. A stopped worker cannot recall an already accepted message. Roll back only to server code compatible with installed apps; unpublishing a feed or disabling a download does not uninstall APKs or immediately clear an offline mandatory-policy cache. Database restore or destructive cleanup requires its own reviewed approval.

More detail: [notification management](native-notification-management.md), [order notification safeguards](native-order-notifications.md), and [direct distribution and signing](native-direct-distribution.md).
