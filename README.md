# Printly

Printly is a Next.js and Supabase application for customer print orders, shop operations, and platform administration.

## Run locally

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and configure the Supabase URL, anon key, service-role key, and site URL. The service-role key is server-only; never commit it or expose it in the browser.
3. Apply the SQL migrations in `supabase/migrations` in order, including `0007` and `0008` for shop identities and name-proof review.
4. Run `pnpm dev`. Checks: `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## Access and shop identity

- Shop sign-in: `/login`. The public shop application is `/shop/signup`.
- Administrator sign-in: `/admin/login`. Admins manage applications in `/admin/shops`, separately from the shop workspace.
- Each shop has an immutable, unique public code. Customer links and QR codes use `/s/p-<code>`. Existing name-based links remain valid. The code is a public identifier, **not a password**: authenticated membership and database RLS protect private shop data.
- Names are compared without regard to case or repeated spaces. A unique name needs no name proof. An existing name requires a shop photo or a GSTIN in the correct format, and stays paused pending an administrator's review. A GSTIN format check does not establish ownership or registration. Photos are stored in the private `shop-name-proofs` bucket, accessible to administrators only. Owners can replace evidence in Settings if changes are requested.
- Demo credentials in the historical seed are publicly known and are suitable only for isolated development. If a seeded admin exists on a shared deployment, change its password immediately using **Admin → Settings**, and provision a real administrator account before real-world use.
