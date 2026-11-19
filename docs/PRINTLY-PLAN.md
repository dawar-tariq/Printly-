# Printly — Product & Technical Plan

**QR-to-Print Marketplace for Indian Print Shops**

> Scan QR → Upload → Pay → Collect. The simplest way to get documents printed at local shops.
>
> Status: **APPROVED (MVP scope) — building Sprints 0–3.**
> Prepared: 2026-11-19 · Approved with decisions below.
>
> **Approved decisions (2026-11-19)**
> - Scope: **MVP only** (Sprints 0–3). Sprints 4–6 deferred.
> - **Payments: NO Razorpay.** Shop-owner's own **UPI collect (intent link + UPI QR)** rendered as a
>   gateway-style checkout ("Paid to <shop>"), because it is **free**. Shop owner sets price &amp; adds
>   their UPI ID in Settings; customer pays out-of-band, taps "I've paid" (optional UTR); **shop owner
>   confirms receipt in dashboard** before the order enters the print queue. COD also supported.
>   Razorpay remains a future option behind a feature flag.
> - **OTP: Email OTP** (Supabase Auth) as interim SMS; MSG91 later.
> - **Hosting: `*.vercel.app`** for beta; custom domain later.
> - **Commercial defaults:** GST 18%, platform commission 8%, seed rate card B&W ₹2 / Color ₹10 per A4
>   page — all owner-editable per shop. Owner sets their own prices.
> - **Dropbox: customer file import** — in the upload step, import via a Dropbox share link (works
>   with any Dropbox account, zero setup) + Dropbox Chooser button when `NEXT_PUBLIC_DROPBOX_APP_KEY`
>   is configured. Server copies the file into Supabase Storage and page-counts it like an upload.

---

## 1. Executive Summary

Printly is a 3-sided marketplace connecting **customers** (students, professionals, SMBs) who need
documents printed with **local print shops** (1–5 staff) who need orders, payments and file
management — with a **platform admin** layer for oversight, disputes and payouts.

The wedge is the **QR code at the shop counter/window**: no app download, no login for the
customer, scan → upload → price → pay → token → collect. Shops get a queue, digital payments,
and reports without any hardware.

### Goals (MVP)
- A customer can go from scanning a shop's QR to a paid, tracked print token in under 2 minutes.
- A shop can see the live queue, act on orders (print → ready → collected), and see daily revenue.
- An admin can onboard/verify shops, see platform GMV, and resolve disputes/refunds.
- Everything runs on **Supabase + Vercel** so ops are near-zero.

### Non-goals (explicitly out of MVP)
- Native mobile apps (PWA only; the flow is web-first by design — QR opens a URL).
- Delivery/logistics, printing-as-a-service fulfillment by Printly itself.
- Dynamic/variable-data printing, design tools, or document editing.
- Multi-language UI beyond English (Hindi strings prepared, not shipped).
- Automated payouts execution (we compute settlements; disbursal is manual/Razorpay Route later).

---

## 2. Personas & Key Flows

### 2.1 Customer (no app install; phone-first)
1. Scan shop QR (window/receipt) → opens `https://<host>/s/<shop-slug>` (or short code `/q/<code>`).
2. Pick service: **Print / Photocopy / Scan / Bind / Laminate**.
3. Upload files (PDF, DOC/DOCX, JPG/PNG). Client shows auto page-count preview, size check
   (≤ 25 MB/file, ≤ 10 files), server re-verifies with `pdf-lib`.
4. Options per item: copies, color/B&W, paper size (A4/A3/A5/Legal), paper type
   (75/90/100 gsm), sides (single/duplex), binding (none/staple/spiral/hard), lamination.
5. Instant price (shop-configurable rate card + 18% GST) → pay via **UPI collect**
   (intent link / UPI QR of the **shop owner's own UPI ID** — gateway-styled checkout, ₹0 fees)
   or **COD**.
6. Get **token** (shop-scoped, e.g. `A-023`) + ETA once the shop confirms payment.
7. Status pipeline: `Queued → Printing → Ready → Collected` (push via Realtime + SMS if configured).
8. At counter, show token → shop marks Collected → customer rates (1–5 + comment).

Customer auth: **optional for browsing/upload, phone OTP required to pay** (Supabase Phone Auth).
Anonymous session (`auth.signInAnonymously`) created on QR scan; upgraded to phone on payment.

### 2.2 Print Shop
1. Dashboard `/shop`: Today’s board in 4 lanes — **New → In Progress → Ready → Completed**
   (Realtime via Supabase channels).
2. Order detail: file preview/download (signed URLs), customer info, full specs, payment status.
3. Actions: Accept → Mark **Printing** → Mark **Ready** (triggers customer notification) →
   Mark **Collected** (COD: confirm cash; online: release settlement).
4. Queue: reorder by drag/priority flag, per-order ETA, "rush" surcharge toggle.
5. Inventory: paper stock, ink, binding supplies with low-stock alerts (threshold per item).
6. Reports: daily/weekly/monthly revenue, service mix, peak hours (from order timestamps).
7. Settings: rate card per service/paper/size, service toggles, GSTIN, shop profile,
   **QR generator** (download PNG/PDF, table-talker layout), payout bank details & schedule.

Shop auth: email + password (Supabase Auth), role `shop_owner`/`shop_staff`, linked via `shop_staff`.

### 2.3 Admin (Platform)
1. Analytics `/admin`: GMV, order count, active shops, AOV, repeat-rate, cohort retention,
   commission earned — charts by day/week/month.
2. Shop onboarding: application queue → KYC review (GSTIN, PAN, cancelled cheque) → Approve /
   Reject / Request changes → verification badge.
3. Disputes: complaint inbox tied to orders → refund (Razorpay refund API) / reject with note.
4. Payouts: weekly settlement run — gross − commission − refunds = net, per shop; status
   `pending → processing → paid`; export CSV.
5. Platform settings: commission rate (default **8%**), feature flags, maintenance mode,
   service catalog, default rate card template.

Admin auth: email + password, role `admin` (allowlist by email + `profiles.role`).

---

## 3. Tech Stack & Architecture

| Layer | Choice | Why |
|---|---|---|
| App framework | **Next.js 15 (App Router) + TypeScript + React 19** | Auth-aware SSR for shop/admin, static for marketing; one deployable |
| UI | **Tailwind CSS v4 + shadcn/ui + lucide-react** | Fast, consistent, accessible |
| Data/Backend | **Supabase** (Postgres 17, Auth, Storage, Realtime, Edge Functions) | Managed; RLS for multi-tenant isolation; Realtime for the queue |
| Validation | **Zod** shared between client & server | Single source for API contracts |
| Payments | **UPI collect (intent link + UPI QR)** of the shop owner's own UPI ID, rendered as a gateway-style checkout + manual shop-side confirmation; **COD**. Zero fees, zero KYC. Razorpay as future flag | India-first, free, no fund handling by platform |
| File/page count | Supabase Storage (private bucket) + `pdf-lib` server-side page count | Accurate pricing |
| QR | `qrcode` npm lib, server-rendered PNG/PDF | Counter-printable QR + shop landing |
| Charts | **Recharts** | Reports & admin analytics |
| State | React Server Components + Server Actions + Supabase Realtime | Minimal client state |
| PDF receipts | `@react-pdf/renderer` or server HTML→print | Token receipt with QR |
| Testing | Vitest (unit: pricing engine, RLS policies) + Playwright (E2E: QR→collect) | Pricing correctness is money-critical |
| CI/CD | GitHub → **Vercel** (preview per PR, prod on merge) | Matches connected Vercel account |
| Package manager | pnpm | Fast, disk-efficient |

### Architecture sketch

```
┌─────────────┐   QR scan    ┌──────────────────────────┐
│  Customer    │ ───────────▶ │  Next.js on Vercel        │
│  (browser)   │              │  /s/[slug]  customer PWA    │
└─────────────┘              │  /shop/*    shop dashboard  │
                             │  /admin/*   admin console    │
┌─────────────┐              │  /api/*     route handlers   │
│  Shop /      │ ───────────▶ │  (Razorpay webhook, uploads,│
│  Admin       │              │   status transitions)        │
└─────────────┘              └───────┬───────────────┬─────┘
                                     │               │
                        ┌────────────▼───┐   ┌──────▼─────────┐
                        │ Supabase        │   │ Razorpay        │
                        │ Postgres + RLS  │   │ Orders/Checkout │
                        │ Auth (OTP/email)│   │ + Webhooks      │
                        │ Storage (files) │   └─────────────────┘
                        │ Realtime (queue)│
                        └─────────────────┘
```

**Tenancy model:** single database, `shop_id` on every tenant row, enforced by **Row Level
Security** policies (customers see own orders; staff see only their shop; admins see all).
No tenant can read another's files: storage paths are `{shop_id}/{order_id}/{file}` with
storage RLS + short-lived signed URLs only minted server-side.

### Environments
- **Local dev** → local Supabase CLI or the hosted `printly-dev` project.
- **Preview** (Vercel PR previews) → same dev project.
- **Production** → `printly` project, `ap-south-1` (Mumbai) for low latency to Indian users.

---

## 4. Data Model (Postgres / Supabase)

All tables: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`,
plus `updated_at` where mutable. Money stored as **integer paise** (`*_paise`) to avoid float
errors. RLS enabled on every table.

### Identity & tenancy
- **profiles** — `id (=auth.users.id)`, `role` enum(`customer`,`shop_staff`,`admin`), `full_name`,
  `phone`, `avatar_url`.
- **shops** — `owner_id → profiles`, `slug` unique, `name`, `address`, `city`, `phone`,
  `gstin`, `pan`, `kyc_status` enum(`pending`,`approved`,`rejected`,`changes_requested`),
  `status` enum(`active`,`paused`,`suspended`), `commission_bps` int (default 800 = 8%),
  `short_code` unique (for `/q/CODE`), `rush_surcharge_bps`, `payout_bank jsonb`,
  `approved_at`, `approved_by`.
- **shop_staff** — `shop_id → shops`, `user_id → profiles`, `role` enum(`owner`,`manager`,`staff`),
  unique(shop_id, user_id).

### Catalog & pricing
- **service_types** — seeded lookup: `print`, `photocopy`, `scan`, `bind`, `laminate` (+ flags).
- **shop_services** — `shop_id`, `service`, `enabled bool`, `display_order`.
- **rate_card** — `shop_id`, `service`, `paper_size` enum(`A4`,`A3`,`A5`,`Legal`) nullable,
  `color` enum(`bw`,`color`) nullable, `sides` enum(`single`,`duplex`) nullable,
  `paper_gsm` int nullable, `unit` enum(`page`,`job`,`sheet`),
  `price_paise` int, `min_qty` int default 1. Unique nulls-not-distinct index per shop/service/dims.

### Orders
- **orders** — `shop_id → shops`, `customer_id → profiles` nullable (anonymous allowed),
  `token` text (per-shop daily sequence, e.g. `A-023`), `status`
  enum(`draft`,`queued`,`printing`,`ready`,`collected`,`cancelled`,`failed`),
  `payment_status` enum(`pending`,`paid`,`cod_pending`,`cod_collected`,`failed`,`refunded`),
  `payment_method` enum(`upi`,`card`,`netbanking`,`wallet`,`cod`),
  `subtotal_paise`, `discount_paise`, `tax_paise` (18% GST), `total_paise`,
  `commission_paise` (snapshot at payment time), `rush bool`, `eta_minutes` int,
  `notes`, `collected_at`, unique(shop_id, token, date).
- **order_items** — `order_id → orders`, `service`, `paper_size`, `color`, `sides`,
  `paper_gsm`, `copies` int, `pages` int (server-verified), `binding` enum
  (`none`,`staple`,`spiral`,`hard`), `lamination bool`, `unit_price_paise`, `line_total_paise`.
- **order_files** — `order_id`, `shop_id` (denormalized for storage RLS), `storage_path`,
  `original_name`, `mime`, `size_bytes`, `page_count` int, `preview_ok bool`.
- **order_status_events** — `order_id`, `from_status`, `to_status`, `by → profiles` nullable,
  `note`, `created_at`. (Audit trail for disputes.)

### Money
- **payments** — `order_id` unique, `provider` (`upi`|`cod`), `utr` text nullable (customer-entered UPI ref),
  `amount_paise`, `status`
  enum(`created`,`submitted`,`confirmed`,`rejected`,`cod_pending`,`cod_collected`),
  `confirmed_by → profiles` nullable, `confirmed_at` timestamptz nullable, `raw jsonb` (audit).
- **refunds** — `payment_id`, `razorpay_refund_id`, `amount_paise`, `reason`, `status`.
- **payouts** — `shop_id`, `period_start`, `period_end`, `gross_paise`, `commission_paise`,
  `refunds_paise`, `net_paise`, `status` enum(`pending`,`processing`,`paid`,`failed`),
  `utr` text, `paid_at`.

### Ops
- **inventory_items** — `shop_id`, `name`, `category` enum(`paper`,`ink`,`binding`,`laminate`,`other`),
  `qty` numeric, `unit`, `low_stock_threshold`, `reorder_qty`.
- **reviews** — `order_id` unique, `shop_id`, `customer_id`, `rating` 1–5, `comment`.
- **disputes** — `order_id`, `raised_by`, `type` enum(`quality`,`missing_pages`,`overcharge`,`other`),
  `description`, `status` enum(`open`,`investigating`,`resolved_refund`,`resolved_reject`),
  `resolution_note`, `refund_id → refunds` nullable, `resolved_by`.
- **notifications** — `user_id` nullable, `shop_id` nullable, `order_id` nullable,
  `channel` enum(`in_app`,`sms`,`email`), `template`, `payload jsonb`, `sent_at`, `status`.
- **platform_settings** — `key` pk, `value jsonb` (commission_bps, gst_bps, flags, maintenance).

### Indexes & constraints
- `orders(shop_id, status, created_at desc)` — queue board.
- `orders(customer_id, created_at desc)` — customer history.
- `payments(utr)` index (lookup by customer UTR).
- Partial index `orders(status) where status in ('queued','printing','ready')` — active queue.
- FK `on delete cascade` from orders → items/files/events.

---

## 5. API Contracts (Next.js Route Handlers)

Client-typed via Zod schemas in `/lib/contracts`. Mutations that need secrets (Razorpay,
uploads) go through handlers; simple reads use Supabase client + RLS directly.

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /api/shops/:slug/public` | anon | Shop card for QR landing (name, services, ETA, rating) — no PII |
| `POST /api/orders` | anon-or-user | Create `draft` order + items from spec; returns `order_id` + upload targets |
| `POST /api/orders/:id/files` | owner-of-order | Upload file → Supabase Storage; server computes page count; returns item quotes |
| `GET /api/orders/:id/quote` | owner-of-order | Authoritative price (re-computes from server rate card + verified pages) |
| `POST /api/orders/:id/pay` | owner-of-order | `method=cod` → `cod_pending`; `method=upi` → returns UPI intent payload (`upi://pay?...`) built from shop's UPI ID + order total, plus deep-link buttons; checkout renders QR + "I've paid" |
| `POST /api/orders/:id/payment-submitted` | owner-of-order | Customer asserts UPI payment done (optional UTR + note) → `payment_status=submitted`; appears in shop's confirm queue |
| `POST /api/orders/:id/import-dropbox` | owner-of-order | Import a file into the order from a Dropbox share/direct link (server-side fetch → Storage); Chooser links supported |
| `POST /api/shop/orders/:id/confirm-payment` | shop staff | `submitted`/`cod_pending` → `confirmed`/`cod_collected` (or `rejected`); on confirm, assign token + ETA → order becomes `queued` |
| `GET /api/track/:orderId` | anon (unguessable id) | Public status snapshot for token tracking |
| `POST /api/shop/orders/:id/status` | shop staff/admin | Transition `queued→printing→ready→collected` with guard checks + `order_status_events`; `ready` fires notification |
| `GET /api/shop/orders?lane=new|in_progress|ready|completed&date=` | shop staff | Queue board payload |
| `PATCH /api/shop/orders/:id/priority` | shop staff | Reorder/rush flag |
| `GET/PUT /api/shop/rate-card` | owner | Rate card CRUD |
| `GET/POST/PUT /api/shop/inventory` | shop staff | Stock + low-stock alerts |
| `GET /api/shop/reports?range=day|week|month` | owner/manager | Revenue, service mix, peak hours |
| `GET /api/shop/qr?format=png|pdf` | owner | QR for `/s/<slug>` (and short code) |
| `POST /api/admin/shops/:id/kyc` | admin | Approve/reject/request changes |
| `GET /api/admin/analytics?range=` | admin | GMV, AOV, orders, active shops, retention |
| `GET/POST /api/admin/payouts` | admin | Generate settlement run; mark paid (+UTR) |
| `GET/POST /api/admin/disputes` | admin | List; resolve → optional Razorpay refund |
| `GET/PUT /api/admin/settings` | admin | Commission, GST, flags |

**Error contract:** `{ error: { code, message, field? } }` with proper HTTP status; validation
errors 422; RLS-denied 403; conflicts (double status transition) 409.

**Idempotency:** status transitions and payment confirmation check current state inside a transaction
(`select ... for update`) — safe against retries/double-clicks.

---

## 6. Pricing Engine (money-critical)

Pure function in `/lib/pricing.ts`, unit-tested:

```
line = unit_price(shop rate card, service, dims) × pages(verified) × copies × (rush ? 1+rush_bps : 1)
subtotal = Σ lines
discount = promo (later) 
tax      = round((subtotal − discount) × 18%)        // GST, configurable in platform_settings
total    = subtotal − discount + tax
commission_paise = round(total × shop.commission_bps / 10000)   // snapshot on payment
```

Rounding: half-up, per line, in integer paise. Rate card lookup falls back: exact dims →
service default → platform default template (so a new shop is never un-orderable).

---

## 7. Security & Compliance

- **RLS** on every table; storage RLS mirrors order tenancy; service-role key only in
  server handlers/webhooks.
- **Auth:** email OTP (customer interim, Supabase + SMTP), email/password (shop/admin),
  anonymous sign-in for scan session upgraded to email OTP at payment.
- **Files:** allowlist MIME (pdf/doc/docx/jpg/png), 25 MB cap, ≤ 10 files, random storage
  names, signed URLs (5 min TTL), auto-delete drafts after 24 h (pg_cron), collected orders
  after 30 days (configurable).
- **Webhooks:** Razorpay signature verification (HMAC-SHA256) required; event log retained.
- **PII:** phone masked in shop UI beyond need; admin access audit-logged
  (`order_status_events` + `admin_audit` later).
- **Compliance notes:** GST invoice fields on order (GSTIN optional for B2C), data retention
  policy, KYC doc encryption note for MVP (manual review).
- **No secrets in repo** — `.env.local` gitignored; Vercel env vars per environment.

---

## 8. Sprint Plan (2-week sprints) & MVP Definition

### MVP = Sprints 0–3 (≈ 8 weeks to real users)
QR landing → upload → pay (Razorpay test/COD) → token → shop queue board → ready notification
→ collected → review. Admin: shop approval + basic GMV. **Success metric: 1 real shop, 25 real
orders, ≥ 80% "order completed without help".**

| Sprint | Theme | Deliverables |
|---|---|---|
| **0 — Foundation** (wk 1) | Repo, design system, CI, DB | pnpm + Next.js 15 scaffold, Tailwind/shadcn, ESLint/TS strict, Vitest, Supabase project `printly` (ap-south-1), migrations + RLS, seed (1 demo shop, rate card), Vercel project + GitHub link, env wiring, preview deploys |
| **1 — Customer flow** (wk 2–3) | Scan → order | QR landing `/s/[slug]`, service picker, upload w/ page-count + preview, options UI, pricing engine + tests, order create + tracking page (Realtime), anonymous auth |
| **2 — Payments & shop queue** (wk 4–5) | Money + shop | **UPI collect checkout (gateway-styled, shop's own UPI ID)**, payment-submitted + shop confirm flow, COD path, email-OTP customer auth, token generation, shop dashboard 4-lane board, order detail + status actions, ready notification (Realtime + email/SMS hook), collected + review |
| **3 — Admin & hardening** (wk 6–8) | Ops + launch | Admin console (shop KYC approve/reject, GMV/order/AOV charts, disputes, manual payout marking), inventory low-stock, rate-card settings, QR PDF/PNG generator, error tracking, E2E (Playwright: full QR→collect), load sanity, **closed beta with 1–2 shops** |
| 4 — Reports & polish | Shop depth | Daily/weekly/monthly reports, peak-hours chart, rush surcharge, reorder/priority, payout CSV export, email receipts |
| 5 — Growth | Reliability | Promo codes, SMS notifications end-to-end, retention view, GST invoice PDF, abuse controls (rate limits, file scanning), Hindi UI strings |
| 6 — Scale | v1.0 | Razorpay Route auto-payouts, multi-staff roles, offline-tolerant PWA for shops, admin feature flags, observability (Sentry), perf budget |

Each sprint ends with a demo-able build and a tagged release on the branch.

---

## 9. Infrastructure on the Connected Accounts

**Supabase** (org: *Starters*, existing projects: Flickerz Nest, Pdfkit — left untouched):
- Proposed: **new project `printly`** in **`ap-south-1` (Mumbai)**, plan `free` to start
  (upgrade to `pro` before real customer data / when SMS OTP goes live).
- Migrations via `create_migration`; seeds via SQL; edge functions for webhook verification
  if route handler latency demands it.

**Vercel** (team: *starterkartt-8285s-projects*, hobby plan):
- Proposed: **new project `printly`**, framework `nextjs`, linked to this GitHub repo,
  env vars per environment; PR previews enabled.

**Git:** all work on branch `arena/309fdf51-printly`; PRs into `main` after approval gates.

---

## 10. Open Questions (needed before Sprint 0)

1. **Payments:** Razorpay account/keys available? (Test keys suffice for MVP.) Without them,
   MVP ships in **COD + simulated payment** mode and Razorpay is wired behind a feature flag.
2. **SMS/OTP:** Supabase phone auth needs an SMS provider (Twilio/MSG91/2factor). Use
   **MSG91** (India, cheap) or email-OTP as interim? MSG91 credentials needed for real OTP.
3. **Supabase project:** fresh `printly` project (recommended) vs. reuse an existing one?
4. **Domain:** `printly.in`-style custom domain (DNS on Vercel) or `*.vercel.app` for beta?
5. **GST & pricing defaults:** confirm 18% GST, 8% commission default, and the seed rate card
   (B&W A4 ₹2/page, Color ₹10/page, Spiral ₹30, etc.).
6. **Scope of this engagement:** build through Sprint 3 MVP only, or also 4–6?

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Shops distrust digital payout control | COD default on, weekly manual payouts with UTR, shop-facing payout statement |
| Customers won't OTP-gate before pay | Allow COD without phone (token only), OTP required for online pay |
| Wrong page counts → wrong price | Server-side verification with pdf-lib; price confirmed pre-payment; "shop can adjust ±10% with reason" escape hatch |
| File privacy (IDs, contracts) | Private bucket, signed URLs, auto-purge, no public enumeration |
| Payment/confirmation mismatch | Idempotent state machine (`pending → submitted → confirmed`); UTR reference capture; shop always has final say before printing; COD always available |
| Scope creep | Strict MVP cut; anything beyond Sprint 3 is a new approval |
