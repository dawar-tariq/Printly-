# Native app, customer details and performance candidate

This is a **code candidate**, not evidence of a production deployment. The existing native gateway and this candidate must be reviewed and deployed separately; do not deploy the unrelated dirty working tree or the deferred migrations. No new database migration is included. Check an isolated environment, backups, credentials, access rules and rollback before changing production.

## Customer details after a QR scan

At checkout, “Remember my details on this browser” is off by default. With explicit opt-in, a valid name, phone number and optional email are saved in that browser's `localStorage` and can fill a future checkout at any Printly shop on the same origin. Customers can edit them, switch the option off, or clear saved details from the first order screen or checkout. Clearing them does not alter an in-progress payment or remove details already submitted to a shop. English, Hindi and Urdu explain the choice.

The saved record expires 90 days after it is saved or changed. An expired or invalid record is ignored and removed on the next visit; browser settings or private mode may clear it sooner. Storage may be blocked. It is not an account, is not encrypted by this feature, and is not shared across browsers/devices; anyone with access to the same browser or site scripts can read it, so shared devices are discouraged. Checkout-recovery storage remains separate and never contains these contact details. No customer contact data is stored in Redis.

## Owner board freshness

The website already listens to Supabase Postgres Changes and has a visible-page 15-second polling fallback. The native Home and Orders screens now fetch immediately when foregrounded, listen for advisory `INSERT`/`UPDATE` events for their own shop, debounce bursts, and still poll every 15 seconds by default while visible. A reconnect triggers a fresh board fetch. Screens show the last successful check and flag failures as possibly stale. Network events are never treated as authoritative data or displayed; each refresh still uses the authenticated, membership-checked board API. The app subscribes using the user's access token over TLS, validates the configured Supabase host and expected shop filter, and does not log event rows or tokens. It closes the socket when the screen is not active. `DELETE` events are not subscribed because filtering/authorization has special limitations; polling catches missed events and removals.

Supabase Realtime must actually be enabled for `public.orders` and its RLS policies must be verified for the deployed project. No production publication or RLS change is made by this candidate. Verify both same-shop delivery and cross-shop denial in an isolated project first; the disposable backend CI enables the publication only inside its local test stack. Realtime may disconnect, be delayed, or be unavailable; it is not a delivery guarantee or a push notification, and polling is the fallback. This does not provide background notifications. Consider simultaneous connection counts, database reads, cost and observed latency before changing the refresh interval.

## Optional Redis

Redis is not used for authorization, rate limiting, customer contacts, orders, payments, prices, availability or real-time delivery. PostgreSQL/Supabase remains authoritative. If a managed Upstash Redis REST service is chosen after a cost/latency review, set these **server-only** environment variables in the intended environment:

- `PRINTLY_REDIS_REST_URL`: the HTTPS origin of the `*.upstash.io` REST endpoint, without credentials, path or query.
- `PRINTLY_REDIS_REST_TOKEN`: its secret REST token; never put it in a client bundle or commit it.
- `SUPABASE_SERVICE_ROLE_KEY`: the existing server-only key, also used with domain separation to authenticate cached QR bytes. Rotating it invalidates old cache signatures, which is safe.

Both Redis settings are optional; leave either unset to render locally. After the owner's membership and current canonical shop link have been checked normally, the website and native gateway share a cache of the derived **public shop QR PNG**. The key hashes the URL; the image itself can be decoded to reveal that public URL. Entries are signed to reject tampering/cross-shop substitution and expire in one hour. A 300 ms timeout, size bounds and temporary per-instance circuit breaker fall back to local rendering if Redis fails. Bump `printly:public-shop-qr:v1` when QR artwork or encoding changes. The first request incurs a miss and caching can be slower in a distant region: compare real timings and costs before enabling it. No hosted Redis has been configured or tested here. A local Redis 7.4.2 test exercises GET/SET/expiry through a simulated REST adapter; it does **not** verify Upstash TLS, credentials, region or hosted behavior.

## Minor updates without reinstalling

After the new native binary and its backend are deployed, the native app fetches `/api/native/v1/experience` on entering the foreground and approximately every five minutes while foregrounded. It can safely change only these bounded presentation settings without another APK update:

- `PRINTLY_NATIVE_NOTICE`: plain-text home notice, maximum 180 characters.
- `PRINTLY_NATIVE_HOME_SUBTITLE`: plain-text home subtitle, maximum 120 characters.
- `PRINTLY_NATIVE_BOARD_REFRESH_SECONDS`: integer from 10 to 60; default 15.

Invalid values are ignored, and if fetching fails the app retains its last in-memory safe values or built-in defaults. These are deployment environment variables, so changing them normally requires a **server rollout**; the installed app then picks them up without reinstalling. They are not a remote code/update system. The website itself receives deployed website changes on a subsequent page load. Native layouts, functionality, permissions, libraries and security fixes that require different compiled code still need a signed app update through an appropriate distribution channel. Never download or silently execute arbitrary code or an unverified APK. The current demo is synthetic and cannot demonstrate live server settings.

## Validation and release

Run website tests/typecheck/build from a clean candidate and the Android workflow, including the offline demo/emulator and local TLS WebSocket tests. The disposable Supabase integration checks native gateway access and Realtime filtering with two synthetic shops. Before a release, additionally test on a physical Android device against an isolated backend: session expiry/refresh, lost connections/reconnects, foreground/background, cross-shop RLS, concurrent orders, maintenance, the optional cache's failure behavior, QR decoding, checkout recovery and realistic load. Review privacy text and any Redis provider terms/region. Publishing or promoting a server deployment, configuring a hosted Redis service, signing a release or replacing the installed owner app requires separate approval and a verified signing key and data backup.
