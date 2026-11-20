# Printly

Printly is a Next.js and Supabase application for customer print orders, shop operations, and platform administration.

## Run locally

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and configure the Supabase URL, anon key, service-role key, and site URL. The service-role key is server-only; never commit it or expose it in the browser.
3. Apply the SQL migrations in `supabase/migrations` in order, including `0007`–`0009` for shop identities, name-proof review, and private shop columns.
4. Run `pnpm dev`. Checks: `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## Shop QR standee

Open **Shop → Settings & QR → Create A4 standee**. The workspace uses the signed-in account's linked shop and its owner's saved profile; it does not create another shop or accept a shop ID from the browser. Generate again after editing saved details. If details change between preview and export, the export asks for a fresh preview. Shops that are not active and approved can still prepare the standee, but customers cannot place orders until the shop is active.

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
