# Printly for Shops — native Android (in progress)

This is a Kotlin/Jetpack Compose Android application. It is not a Trusted Web Activity, browser wrapper, or WebView. The matching gateway is deployed on the live site, but the native APK is **not yet a published production release**. The operator reports a successful partial isolated phone rehearsal; the signed production APK still needs verification and a device test.

## Build variants

- `debug`: package `io.github.dawartariq.printly.owner.native.debug`, labelled **Printly Native Demo**. It uses synthetic in-memory data, cannot access a real shop, and can be installed alongside the existing app. The demo is not a release and must not be used to make payments.
- `qa`: package `io.github.dawartariq.printly.owner.native.qa`, labelled **Printly Isolated Test** and signed with a disposable debug key. It uses live network calls but is pinned to the existing staging Auth host. It requires an explicitly supplied, independently verified test-only HTTPS website and synthetic accounts; never distribute it to owners or use real shop data. A different website hostname alone does not prove its backend is isolated.
- `release`: package `io.github.dawartariq.printly.owner`, version code 4. It is configured for `https://printly0.vercel.app` and the production authentication project. The operator reports no existing non-test installations. Use the verified release key and retain it securely for future updates; do not distribute a build signed with a disposable key. The signing guard requires `PRINTLY_ANDROID_KEYSTORE_PATH`, `PRINTLY_ANDROID_KEYSTORE_PASSWORD`, `PRINTLY_ANDROID_KEY_ALIAS`, `PRINTLY_ANDROID_KEY_PASSWORD`, and optionally `PRINTLY_ANDROID_KEYSTORE_TYPE` (`JKS` or `PKCS12`). Never commit credentials or keys.

With JDK 17 and Android SDK 36 installed:

```sh
cd apps/printly-owner-native-android
./gradlew testDebugUnitTest assembleDebug
./gradlew connectedDebugAndroidTest  # offline synthetic-data emulator
# After an operator has verified an isolated website backed by the staging
# Supabase project, use its exact public origin in place of the example:
./gradlew assembleQa -PprintlyQaSiteOrigin=https://verified-test-only.example
```

QA refuses missing, malformed and known production website origins. It checks the Auth host returned by the website against the staging project (`rahfmpsdbwbktlobntkm.supabase.co`) before sign-in. This is not a substitute for verifying the website's server-side environment or for reviewing staging data. The QA build does not launch a UPI app; use synthetic references and never send real money. This is not a payment sandbox. The debug signing identity and separate package cannot establish compatibility with an installed production APK; a new debug key may require replacing only a previous QA installation.

The native CI workflow builds and tests the demo and isolated QA variants, inspects their merged manifests, tests the unsigned-release guard, and verifies the review signing path with a temporary CI-only key. It uploads the demo and debug-signed QA as explicitly non-release, seven-day artifacts; the CI release APK is **not** uploaded. No real signing secrets or live customer data are used in this workflow. The separate protected native review workflow and the direct-download release gates are described in `docs/native-direct-distribution.md`.

## Current functionality

The native screens cover a branded system splash, sign-in and encrypted local sessions, an order board with search, advisory Supabase Realtime updates and foreground polling, order details and private file opening, explicit UPI payment review, order transitions, inventory, reports, shop profile and service settings, availability, existing rate prices, shop QR/standee sharing, subscription quotes/payment reports, and expired-shop order recovery. System share sheets and third-party document/UPI apps are launched only for those specific operations; no web content is embedded. See `docs/native-performance-and-updates.md` for Realtime prerequisites, optional Redis, customer contact privacy and the limited server-driven presentation settings.

Important limits:

- Adding/removing rates or changing their dimensions is not implemented in the native app. Existing prices can be changed one at a time with a value-based server-side comparison; inventory changes also compare the displayed values. These checks cannot detect an ABA change (a value changed and later changed back). Use a separately supported management channel for other rate edits until an atomic compare-and-replace backend is available.
- Profile and availability writes use the existing server's last-write-wins behavior and services can be partially saved; coordinate edits across devices. After an uncertain change, refresh and check the saved values before trying again. Inventory creation has no idempotency key: check the current list before adding again. The app refuses to show a truncated inventory and currently cannot load more than 1,000 items.
- Native account signup, password changes, forgotten-password recovery, push notifications, and in-app printing are not implemented. Realtime is advisory, depends on the deployed publication and RLS, and works only while the Home or Orders screen is foregrounded; polling remains the fallback. Opening or sharing an order file delegates to another installed app.
- Server-delivered notice text, the home subtitle and a bounded board refresh interval can change without reinstalling this app after the matching backend is deployed. Other native behavior, layout, permissions and security fixes still require a properly signed binary update.
- Reports include currently confirmed/collected orders **created** during the selected India-time period, not payments by payment date, and do not deduct refunds. The native backend refuses to return an incomplete report over 1,000 orders; choose a shorter period. It is not an accounting ledger.
- Payment and subscription actions require operator review. A reported transfer is not proof of payment; a duplicate reference needs a separate deliberate acknowledgement. A subscription request key is stored before the write and reused after an uncertain result. Review request history and do not pay again when a response is uncertain.
- On-device sessions use Android Keystore AES-GCM, with backup and cleartext traffic disabled. Files shared with a viewer are cached privately and granted access via an unexported `FileProvider`; another app can retain its own copy after the owner opens/shares it.

## Backend candidate and release boundary

The matching candidate consists of `src/lib/api.ts`, `src/lib/native-session.ts`, `src/lib/native-me.ts`, `src/lib/native-order.ts`, `src/lib/native-inventory.ts`, `src/lib/native-recovery.ts`, `src/lib/native-rate-card.ts`, `src/lib/native-reports.ts`, `src/lib/shop-report-period.ts`, and the routes under `src/app/api/native/v1/`, plus their tests. The gateway allowlists methods and paths, verifies each bearer token with Supabase Auth, and delegates to existing shop membership, entitlement and mutation checks. It does not put the service-role key in the app. It does not require a new database migration when applied to the production schema through 0021.

Do not deploy a dirty working tree. This repository also contains unrelated deferred changes and migrations. The live gateway was deployed from the explicit clean web candidate, not those deferred files. Maintenance applies to the native gateway too. The operator reports restore-tested database and Storage backups; these were not independently inspected. See `docs/native-direct-distribution.md` for release and rollback limits, including the older website's lack of a native gateway.
