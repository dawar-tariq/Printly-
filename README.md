# Printly

Printly is a Next.js and Supabase application for customer print orders, shop operations, and platform administration.

## Run locally

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and configure the Supabase URL, anon key, service-role key, and site URL. The service-role key is server-only; never commit it or expose it in the browser.
3. Apply all SQL migrations in `supabase/migrations` in order, including `0007`–`0009` for shop identities and privacy, `0010` for transactional checkout safeguards, and `0011` for subscriptions. The application and database changes must be released together; see the rollout notes below.
4. Run `pnpm dev`. Checks: `pnpm typecheck`, `pnpm test`, and `pnpm build`.

### Production rollout of `0010`

Use a planned maintenance window and a verified database backup. Stop new checkouts, apply `0010` transactionally, deploy the matching application, and verify customer checkout and shop payment confirmation before reopening. Do not leave the old code running against the new schema or deploy the new code against the old schema. Customers with pre-upgrade drafts must restart them; a customer who already sent a UPI payment should **not** pay again. If their old browser session cannot report the payment, the shop can find the order using its tracking link, record the customer's report, then independently verify and confirm the transfer.

## Subscriptions

Printly has **one all-features plan** with monthly, six-month and yearly terms. In **Admin → Subscription**, configure each price, Printly’s receiving UPI ID, the payee name and the in-app reminder window (1–30 days). Prices and recipient start unset: an unset price disables that term, and no purchase can start until both UPI details are configured. Prices are stored in paise; changes apply to new requests only. The recipient and price of an existing request are preserved. If another admin changes the plan while a settings form is open, saving is rejected; reload the saved values and review your edits rather than overwriting them.

The shop owner starts a request in **Shop → Subscription**, sends a one-time UPI transfer to Printly and submits its transaction reference. A report is **not** proof of payment and never activates access. In **Admin → Subscription**, independently check the actual receiving account, reference, amount and recipient before approving. An approved term is added after the end of any remaining entitlement, in calendar months using India time (Asia/Kolkata); rejected reports require a reason shown to the owner. Requests, decisions and permanent grants are recorded. There is no payment gateway, automatic verification, recurring charge or email/SMS reminder. Owners see an in-app warning and a once-per-session popup near expiry. If a transfer may have been sent but reporting fails, check the current request or contact Printly; do not pay twice.

An admin may grant or revoke **permanent free access** for any shop without a purchase. This overrides but does not erase its paid or transition period; revoking it restores any remaining time. If permanent access is granted while a request is in progress, an owner who already paid can still submit the reference for review; otherwise they should cancel the unpaid request.

After expiry or when unsubscribed, the dashboard and ordinary shop-management APIs are locked, and the storefront will not accept new orders. **Shop → Open orders** remains available to staff for open jobs, customer UPI reports and looking up a specific previously placed order by tracking link. Transfers and refunds are handled separately; cancelling an order does not automatically refund it. Previously issued signed file URLs cannot be revoked until they expire. Historical commission/payout records are retained in the database for audit but their interfaces and new commission calculations have been removed; new checkout records zero commission.

### Production rollout of `0011`

Schedule a maintenance window, take and verify a backup, block access to older deployments and direct bypass paths, and allow in-flight checkout activity to finish. Apply `0011` and deploy the matching application as one coordinated cutover: the old app’s checkout snapshot is incompatible with the new database function, while the new app requires the new subscription tables. Do **not** deploy or roll back just one side. The migration grants every shop existing at that moment a one-time **30-day transition**, starting at migration time; shops created afterward have no free period. Do not reapply or reset it as a renewal mechanism.

Set the actual prices and receiving UPI details in the admin console; none are supplied by this repository. If the operator explicitly chooses to configure them after reopening, payment requests remain disabled, new shops cannot buy a term, and existing shops' 30-day transition is already counting down. Verify the transition rows, admin configuration, storefront availability, expiry lockout, existing-order recovery and a non-financial test of request/approval and permanent grant/revoke using an isolated test shop. Never mark a real payment approved without confirming its transfer. Make a coordinated rollback/recovery plan for both code and database before the cutover; do not discard historical payment data.

## Printly brand and QR artwork

The selected Printly logo is available in `public/brand/printly-logo-kit.zip`, including scalable SVGs and transparent PNGs for light and dark backgrounds. The website, browser icon, maintenance notice, order slip and QR artwork use the same mark. Newly generated shop QR codes and standees place a small white-backed mark in the code, use high error correction, and retain a four-module quiet zone. If a UPI payment QR would be too dense for a central logo, the mark is shown alongside the unobstructed code instead; the underlying payment link is unchanged.

Existing printed QR signs do not change automatically. Generate and print new QR codes or standees to use the new artwork; old codes keep their existing shop links. Always test the new print with the phones and printer in use.

## Shop QR standee

Open **Shop → Settings & QR → Create A4 standee**. The workspace uses the signed-in account's linked shop and its owner's saved profile; it does not create another shop or accept a shop ID from the browser. Generate again after editing saved details. If details change between preview and export, the export asks for a fresh preview. Shops with an active subscription can prepare a standee before approval, but customers cannot place orders until the shop is active and its subscription is current.

The standee QR opens `/s/p-<code>/order` for that shop. Set `NEXT_PUBLIC_SITE_URL` to the canonical site origin (no path, query, or credentials; HTTPS in production); the request's Host header is never used as a fallback. The existing simple QR in Settings remains available and points to the shop landing page. Standee responses are private and uncached.

The preview, one-page vector PDF, 300-dpi PNG and print view come from the same A4 artwork. The PDF embeds fonts for template text; shop and owner names are shaped as vector outlines for consistent complex-script rendering. Bundled fonts cover Latin, Arabic and Devanagari; unsupported characters or names that cannot fit produce a visible error instead of missing glyphs or clipping. Font licences are in `src/assets/standee-fonts/`.

Print on A4 portrait at actual size (100%), with browser headers and footers disabled. Always check the print preview and scan a paper copy with the phones and printer you plan to use. Automated tests decode both shops' generated PNGs and PDF rasters, including simulated grayscale, but do not substitute for physical Android/iPhone and paper tests.

## Access and shop identity

- Shop sign-in: `/login`. The public shop application is `/shop/signup`.
- Administrator sign-in: `/admin/login`. Admins manage applications in `/admin/shops`, separately from the shop workspace.
- Each shop has an immutable, unique public code. Customer links and QR codes use `/s/p-<code>`. Existing name-based links remain valid. The code is a public identifier, **not a password**: authenticated membership and database RLS protect private shop data.
- Names are compared without regard to case or repeated spaces. A unique name needs no name proof. An existing name requires a shop photo or a GSTIN in the correct format, and stays paused pending an administrator's review. A GSTIN format check does not establish ownership or registration. Photos are stored in the private `shop-name-proofs` bucket, accessible to administrators only. Owners can replace evidence in Settings if changes are requested.
- Demo credentials in the historical seed are publicly known and are suitable only for isolated development. Change a seeded admin password in **Admin → Settings** and a seeded shop password in **Shop → Settings & QR** before using a shared deployment. Provision real accounts before real-world use.
- The current shop application creates email-confirmed accounts without sending a verification email. This bypasses Supabase's email-confirmation setting; implement and configure verified-email onboarding (including production SMTP and redirect URLs) before relying on email address ownership or launching publicly.

## Maintenance mode

In **Admin → Settings**, check **Enable maintenance mode** and select **Save settings**. Once saved, public/customer and shop pages return a self-contained maintenance page with HTTP 503, and their application APIs return a non-cacheable 503 error. The admin sign-in, console and admin APIs remain available and still require normal authorization; uncheck and save to reopen the site. Already-open pages check again while visible, about every 30 seconds and on focus, and display the notice without discarding their current input. Visitors who loaded the standalone maintenance page can use **Try again**. If the setting cannot be read, public requests fail closed with a generic unavailable message; the admin area remains accessible so the setting can be checked.

This is an application-level gate, not a database lock. Requests already in progress can finish, external UPI transfers cannot be stopped, and previously issued signed storage URLs or direct Supabase access are not revoked by the switch. Older deployments that do not contain this gate can also bypass it if their URLs remain accessible. For schema cutovers or sensitive maintenance, separately block old deployments and direct access as needed and allow in-flight work to finish before proceeding.

## Customer previews and shop printing

- Customers can preview and crop/rotate individual PDF pages or JPEG/PNG images before checkout. Save replaces the file the shop receives; **PDF cropping is not redaction**: cropped-out PDF content can still exist in the file. Do not use it to hide confidential material. Image editing re-encodes the image. Reset restores the current page's unsaved edits; a saved edit cannot be undone unless the original is uploaded again.
- Files may be up to 25 MiB each, with at most 10 per order; images are limited to 40 megapixels and PDFs to 2,000 pages. Password-protected/unreadable PDFs must be unlocked or repaired before upload. PDF/image page counts are checked against the file. Word cannot be previewed or reliably counted here: customers must enter the page count from Word, and the shop should confirm layout and price before printing.
- Removing a draft file detaches it and its linked draft items and attempts to delete its storage object. Failed cleanup is recorded for retry, but storage and the database are separate: a delayed signed upload can still leave an orphan after cleanup. Draft operations and previews require a 24-hour, order-scoped, HttpOnly cookie; a tracking link alone does not grant file access. Starting checkout locks file/option edits. Existing drafts created before this change have no draft cookie and must be restarted; placed orders and tracking links are unaffected. Expired drafts also need to be restarted.
- The shop's **Preview & print** shows the file and its linked customer settings. The browser/OS print dialog supplies printer selection and print preview; the operator must check paper size, copies, colour, sides and physical output. The dialog cannot prove a print succeeded. The optional physical-print check is local to that visit and does not change order status. For PDFs up to 20 pages the no-download print flow prepares raster pages at up to 144 dpi; for finer detail or longer documents, open the PDF in a compatible browser viewer or download it. Browser and printer support varies, especially on mobile; verify with the actual device.
- Order files are stored in a private Supabase bucket. An automatic draft/30-day file purge and automatic orphan-cleanup job are **not implemented** in this repository; configure and verify retention and orphan cleanup before promising automatic deletion to customers.
- The tracking page is the source of order updates. The application does not currently send automatic status notifications or email receipts; customers should save their tracking link. From the original browser, they can also report an already-sent UPI payment on that page while their draft session is valid. If their session has expired, the shop can find the order by tracking link and record the customer's report; this is not payment confirmation, and staff must still verify the transfer separately.

## Session behavior

Supabase's cookie-backed session persists across ordinary browser restarts and refreshes while valid. Signed-in linked shop staff visiting the homepage, shop sign-in, or shop application are directed to their workspace; customer shop links and tracking remain public. Private browsing, cleared/blocked cookies, explicit sign-out, revoked/expired refresh tokens or server-side session policies can still require sign-in. Sign out on shared devices.
