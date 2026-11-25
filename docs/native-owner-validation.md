# Native owner app: demo and validation

The Kotlin/Compose owner app is in `apps/printly-owner-native-android/`. Its **debug** build is labelled **Printly Native Demo**, has a different package from the existing owner app, and uses only in-memory sample data. Tap **Skip** and then **Open sample shop**; no real sign-in or payment is needed. Sample changes can be lost when the process or activity restarts. Never use the demo to handle real orders or send payments.

## Automated checks

- `.github/workflows/android-native.yml` builds the demo, runs local Android tests, checks its manifest and signature, checks the missing-release-key guard, compiles a live variant with a disposable key, and exercises the demo on an offline emulator. The disposable-key release is not uploaded.
- `.github/workflows/native-backend-integration.yml` creates and then discards a local Supabase stack on a GitHub-hosted runner. It applies the migrations tracked by the checked-out commit and starts the application against that local stack; no hosted database or production secret is used. `scripts/test-native-integration.mjs` requires an explicit opt-in and loopback URLs before writing synthetic fixtures.
- The local integration checks real Auth tokens and cross-shop denial, order/payment review and duplicate acknowledgement, stale concurrent inventory and rate edits, settings, availability, reports, private signed downloads, subscription idempotency, recovery, and maintenance. These exercise the gateway independently of the Android app.

The offline emulator and local backend checks **do not** test the live Android HTTPS/session flow end to end and do not establish whether the app works on a particular physical phone. A phone test remains necessary. These checks do not constitute a production release or a database backup.

## Release boundary

The native server gateway has not been deployed. The prior approval for a minimal website fix is not approval to deploy it or distribute a production app. Before any live release, review a clean candidate, test the Android client with an isolated backend, confirm the existing signing certificate, arrange verified database/storage backups and a rollback plan, and obtain separate approval. Preserve unrelated work and migrations; do not deploy the dirty working tree.
