import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase';
import { Logo } from '@/components/Logo';
import { Star, MapPin, Clock, Printer, FileText, ScanLine, BookOpen, Layers, Copy, ArrowRight, ShieldCheck } from 'lucide-react';
import { formatPaise } from '@/lib/format';
import { findPublicShop } from '@/lib/public-shop';
import { publicShopPath } from '@/lib/shop-identity';

export const dynamic = 'force-dynamic';

const SERVICE_ICONS: Record<string, typeof Printer> = {
  print: Printer, photocopy: Copy, scan: ScanLine, bind: BookOpen, laminate: Layers,
};
const SERVICE_LABEL: Record<string, string> = {
  print: 'Print', photocopy: 'Photocopy', scan: 'Scan to email', bind: 'Binding', laminate: 'Lamination',
};

export default async function ShopLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createServerSupabase();
  const { data: shop, error } = await findPublicShop(supabase, slug);

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="card max-w-md p-8 text-center">
          <Logo />
          <h1 className="mt-5 text-xl font-extrabold">Can’t reach Printly right now</h1>
          <p className="mt-2 text-sm text-neutral-600">The shop directory is temporarily unavailable. Please try again in a moment.</p>
        </div>
      </div>
    );
  }
  if (!shop) notFound();
  const active = shop.status === 'active';

  const [{ data: services }, { data: rates }] = await Promise.all([
    supabase.from('shop_services').select('service, enabled, display_order').eq('shop_id', shop.id).eq('enabled', true).order('display_order'),
    supabase.from('rate_card').select('service, price_paise').eq('shop_id', shop.id),
  ]);
  const startingAt = new Map<string, number>();
  for (const r of rates ?? []) {
    const cur = startingAt.get(r.service);
    if (cur === undefined || r.price_paise < cur) startingAt.set(r.service, r.price_paise);
  }

  return (
    <div className="min-h-screen">
      <header className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
        <Logo />
        <span className="chip bg-neutral-100 text-neutral-600"><ShieldCheck size={12} /> Verified shop</span>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-24">
        {/* Shop card */}
        <section className="card p-5 mt-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">{shop.name}</h1>
              <p className="mt-1 text-xs font-semibold text-neutral-500">Shop code <span className="font-mono">{shop.short_code}</span></p>
              <p className="mt-1 text-sm text-neutral-500 flex items-center gap-1.5"><MapPin size={14} />{shop.address}{shop.city ? `, ${shop.city}` : ''}</p>
              <p className="mt-1 text-sm text-neutral-500 flex items-center gap-1.5"><Clock size={14} />Avg. ready in ~{shop.eta_minutes} min</p>
            </div>
            <div className="text-right shrink-0">
              <div className="flex items-center gap-1 justify-end font-bold"><Star size={16} className="fill-amber-400 text-amber-400" />{shop.rating_avg || '—'}</div>
              <div className="text-xs text-neutral-400">{shop.rating_count} reviews</div>
            </div>
          </div>
          {!active && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
              This shop is not accepting orders right now. Please check back soon.
            </div>
          )}
        </section>

        {/* Services */}
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400 px-1">Services & starting prices</h2>
          <div className="mt-2 card divide-y divide-neutral-100">
            {(services ?? []).map(({ service }) => {
              const Icon = SERVICE_ICONS[service] ?? FileText;
              const from = startingAt.get(service);
              return (
                <div key={service} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="w-10 h-10 rounded-xl bg-orange-50 text-orange-700 grid place-items-center"><Icon size={20} /></span>
                  <div className="flex-1">
                    <div className="font-semibold">{SERVICE_LABEL[service] ?? service}</div>
                    <div className="text-xs text-neutral-400">{service === 'bind' ? 'Staple / spiral / hard cover' : service === 'laminate' ? 'Per sheet' : 'Per page'}</div>
                  </div>
                  <div className="text-sm font-bold text-neutral-700">{from !== undefined ? `from ${formatPaise(from)}` : ''}</div>
                </div>
              );
            })}
            {(services ?? []).length === 0 && <div className="px-4 py-6 text-sm text-neutral-400">Services will appear here once the shop goes live.</div>}
          </div>
        </section>

        {/* CTA */}
        {active && (
          <Link href={`${publicShopPath(shop.short_code)}/order`} className="btn btn-primary w-full h-14 text-lg mt-6 shadow-lg shadow-orange-600/20">
            Start your order <ArrowRight size={20} />
          </Link>
        )}
        <p className="mt-3 text-center text-xs text-neutral-400">No app needed · Pay the shop directly on UPI · Collect with your token</p>
      </main>
    </div>
  );
}
