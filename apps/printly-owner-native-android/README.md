# Printly for Shops — native Android (in progress)

This is a Kotlin/Jetpack Compose Android application. It is not a Trusted Web Activity, browser wrapper, or WebView. It is **not yet a production release**: the matching server gateway is local, has not been deployed, and an authenticated end-to-end test against an isolated real backend and a physical device is still required.

## Build variants

- `debug`: package `io.github.dawartariq.printly.owner.native.debug`, labelled **Printly Native Demo**. It uses synthetic in-memory data, cannot access a real shop, and can be installed alongside the existing app. The demo is not a release and must not be used to make payments.
- `release`: package `io.github.dawartariq.printly.owner`, version code 3. It is configured for the existing Printly origin and authentication project. It cannot function until the native backend is separately reviewed and deployed. It must be signed with the independently verified existing release key to replace the prior owner app; do not distribute a build signed with a disposable key. The signing guard requires `PRINTLY_ANDROID_KEYSTORE_PATH`, `PRINTLY_ANDROID_KEYSTORE_PASSWORD`, `PRINTLY_ANDROID_KEY_ALIAS`, `PRINTLY_ANDROID_KEY_PASSWORD`, and optionally `PRINTLY_ANDROID_KEYSTORE_TYPE` (`JKS` or `PKCS12`). Never commit credentials or keys.

With JDK 17 and Android SDK 36 installed:

```sh
cd apps/printly-owner-native-android
./gradlew testDebugUnitTest assembleDebug
./gradlew connectedDebugAndroidTest  # offline synthetic-data emulator
```

The native CI workflow builds and tests the demo, inspects the merged manifest, tests the unsigned-release guard, and compiles the live variant with a temporary CI-only key. The CI release APK is **not** uploaded. No real signing secrets or live customer data are used in this workflow.

## Current functionality

The native screens cover sign-in and encrypted local sessions, an order board with search and polling, order details and private file opening, explicit UPI payment review, order transitions, inventory, reports, shop profile and service settings, availability, existing rate prices, shop QR/standee sharing, subscription quotes/payment reports, and expired-shop order recovery. System share sheets and third-party document/UPI apps are launched only for those specific operations; no web content is embedded.

Important limits:

- Adding/removing rates or changing their dimensions is not implemented in the native app. Existing prices can be changed one at a time with a value-based server-side comparison; inventory changes also compare the displayed values. These checks cannot detect an ABA change (a value changed and later changed back). Use a separately supported management channel for other rate edits until an atomic compare-and-replace backend is available.
- Profile and availability writes use the existing server's last-write-wins behavior and services can be partially saved; coordinate edits across devices. After an uncertain change, refresh and check the saved values before trying again. Inventory creation has no idempotency key: check the current list before adding again. The app refuses to show a truncated inventory and currently cannot load more than 1,000 items.
- Native account signup, password changes, forgotten-password recovery, push notifications, and in-app printing are not implemented. Opening or sharing an order file delegates to another installed app.
- Reports include currently confirmed/collected orders **created** during the selected India-time period, not payments by payment date, and do not deduct refunds. The native backend refuses to return an incomplete report over 1,000 orders; choose a shorter period. It is not an accounting ledger.
- Payment and subscription actions require operator review. A reported transfer is not proof of payment; a duplicate reference needs a separate deliberate acknowledgement. A subscription request key is stored before the write and reused after an uncertain result. Review request history and do not pay again when a response is uncertain.
- On-device sessions use Android Keystore AES-GCM, with backup and cleartext traffic disabled. Files shared with a viewer are cached privately and granted access via an unexported `FileProvider`; another app can retain its own copy after the owner opens/shares it.

## Backend candidate and release boundary

The matching candidate consists of `src/lib/api.ts`, `src/lib/native-session.ts`, `src/lib/native-me.ts`, `src/lib/native-order.ts`, `src/lib/native-inventory.ts`, `src/lib/native-recovery.ts`, `src/lib/native-rate-card.ts`, `src/lib/native-reports.ts`, `src/lib/shop-report-period.ts`, and the routes under `src/app/api/native/v1/`, plus their tests. The gateway allowlists methods and paths, verifies each bearer token with Supabase Auth, and delegates to existing shop membership, entitlement and mutation checks. It does not put the service-role key in the app. It does not require a new database migration when applied to the production schema through 0021.

Do not deploy a dirty working tree. This repository also contains unrelated deferred changes and migrations. Build a clean candidate from the current production source plus the explicit native files, review the final diff, use an isolated backend for authenticated integration tests, and arrange a verified database/storage backup and deployment/rollback plan before requesting any production deployment. Maintenance applies to the native gateway too. Existing production and its database are unchanged by the demo build.
