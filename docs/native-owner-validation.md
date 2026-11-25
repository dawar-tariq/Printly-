# Native owner app: demo and validation

The Kotlin/Compose owner app is in `apps/printly-owner-native-android/`. Its **debug** build is labelled **Printly Native Demo**, has a different package from the existing owner app, and uses only in-memory sample data. Tap **Skip** and then **Open sample shop**; no real sign-in or payment is needed. Sample changes can be lost when the process or activity restarts. Never use the demo to handle real orders or send payments.

## Automated checks

- `.github/workflows/android-native.yml` builds the demo, runs local Android tests, checks its manifest and signature, checks the missing-release-key guard, compiles a live variant with a disposable key, and exercises the demo on an offline emulator. The disposable-key release is not uploaded.
- `.github/workflows/native-backend-integration.yml` creates and then discards a local Supabase stack on a GitHub-hosted runner. It applies the migrations tracked by the checked-out commit plus a temporary per-run guard table, and starts the application against that local stack; no hosted database or production secret is used. `scripts/test-native-integration.mjs` requires an explicit opt-in, loopback URLs and the matching randomly generated guard before writing synthetic fixtures. A loopback URL alone can be a tunnel to a hosted database, so never reuse this script against a proxy or an existing project.
- The local integration checks real Auth tokens and cross-shop denial, order/payment review and duplicate acknowledgement, stale concurrent inventory and rate edits, settings, availability, reports, private signed downloads, subscription idempotency, recovery, and maintenance. These exercise the gateway independently of the Android app.

For candidate `f0fd16b6b5e9ff252dea91b1e76b3d01145f2559`, the [Android workflow](https://github.com/dawar-tariq/Printly-/actions/runs/45589111655) passed the demo and local tests, disposable-key live build and offline emulator. The [disposable backend workflow](https://github.com/dawar-tariq/Printly-/actions/runs/45589111803) passed the gateway integration and local Realtime subscription exercise, including an authorized order update and cross-shop RLS denial. The latter enabled the `orders` publication only in that disposable stack.

The delivered synthetic APK is `Printly-Native-DEMO-v2.0.1-Synthetic-Data.apk`, package `io.github.dawartariq.printly.owner.native.debug`, version `2.0.1-native-review-demo` (code 4), SHA-256 `135e403a0ba24b6ee7bef2dae7c196076156a46e7a3664f7c69df9b3ed48b86f`. Its temporary debug signing certificate has SHA-256 `749b04c263d3c3affc85b8c9b63a2b80afc64955627fd7d07f7e4ec2b9dd337d`. This is not the production release certificate. The older synthetic demo used a different debug certificate: if it is already installed, uninstall **only the demo** before installing this build. Doing so removes its sample data, not the separately packaged owner app.

The offline emulator and local backend checks **do not** test the live Android HTTPS/session flow end to end and do not establish whether the app works on a particular physical phone. A phone test remains necessary. The demo cannot demonstrate live Realtime or server-controlled settings. These checks do not constitute a production release or a database backup.

## Release boundary

The native server gateway has not been deployed. The prior approval for a minimal website fix is not approval to deploy it or distribute a production app. Before any live release, review a clean candidate, test the Android client with an isolated backend, confirm the existing signing certificate, arrange verified database/storage backups and a rollback plan, and obtain separate approval. Preserve unrelated work and migrations; do not deploy the dirty working tree.
