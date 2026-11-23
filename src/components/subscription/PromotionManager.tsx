'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Megaphone, Pencil, RefreshCw, TicketPercent } from 'lucide-react';
import { eligibleTerms, promoDescription, type SubscriptionAnnouncement, type SubscriptionPromo } from '@/lib/subscription-offers';
import { paiseToInput, rupeesToPaise, SUBSCRIPTION_TERMS, subscriptionDate, type SubscriptionPlan, type SubscriptionTerm } from '@/lib/subscription';

type Offers = { promos: SubscriptionPromo[]; announcements: SubscriptionAnnouncement[]; promos_has_more: boolean; announcements_has_more: boolean };
type PromoForm = { id: string | null; version: number | null; code: string; type: 'percent' | 'fixed'; value: string; terms: SubscriptionTerm[]; starts: string; ends: string; total: string; perShop: string; enabled: boolean };
type AnnouncementForm = { id: string | null; version: number | null; title: string; message: string; promoCode: string; starts: string; ends: string; enabled: boolean; publicVisible: boolean };
const emptyPromo = (): PromoForm => ({ id: null, version: null, code: '', type: 'percent', value: '', terms: ['monthly', 'six_months', 'yearly'], starts: '', ends: '', total: '', perShop: '1', enabled: true });
const emptyAnnouncement = (): AnnouncementForm => ({ id: null, version: null, title: '', message: '', promoCode: '', starts: '', ends: '', enabled: true, publicVisible: true });
const IST_OFFSET_MS = 330 * 60_000;

function dateInput(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Date(Date.parse(value) + IST_OFFSET_MS).toISOString().slice(0, 16);
}
function dateFromIst(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid date and time in IST.');
  const date = new Date(`${value}:00+05:30`);
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16) !== value) throw new Error('Enter a valid date and time in IST.');
  return date.toISOString();
}
function dateRange(starts: string, ends: string) {
  const from = dateFromIst(starts), to = dateFromIst(ends);
  if (from && to && Date.parse(from) >= Date.parse(to)) throw new Error('The end must be later than the start.');
  return { starts_at: from, ends_at: to };
}
function readLimit(value: string, max: number) {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim())) throw new Error('Usage limits must be whole numbers.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`Use a limit between 1 and ${max.toLocaleString('en-IN')}, or leave it blank for no limit.`);
  return parsed;
}
function stateOf(item: { enabled: boolean; starts_at: string | null; ends_at: string | null }) {
  if (!item.enabled) return 'Paused';
  if (item.starts_at && Date.parse(item.starts_at) > Date.now()) return 'Scheduled';
  if (item.ends_at && Date.parse(item.ends_at) <= Date.now()) return 'Expired';
  return 'Enabled';
}
function canBeFree(type: 'percent' | 'fixed', value: number, terms: SubscriptionTerm[], plan: SubscriptionPlan) {
  if (type === 'percent') return value === 100;
  const prices: Record<SubscriptionTerm, number | null> = { monthly: plan.monthly_paise, six_months: plan.six_months_paise, yearly: plan.yearly_paise };
  return terms.some((term) => prices[term] != null && value >= prices[term]!);
}
const field = 'text-xs font-bold text-neutral-700';
const control = 'input mt-1 w-full text-sm';

function Pages({ label, page, hasMore, disabled, onChange }: { label: string; page: number; hasMore: boolean; disabled: boolean; onChange: (page: number) => void }) {
  if (!page && !hasMore) return null;
  return <nav aria-label={`${label} pagination`} className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
    <span>Page {page + 1}</span><div className="flex gap-2">
      <button type="button" disabled={disabled || page === 0} onClick={() => onChange(page - 1)} aria-label={`Newer ${label}`} className="btn btn-ghost min-h-9 px-3 text-xs disabled:opacity-50">Newer</button>
      <button type="button" disabled={disabled || !hasMore} onClick={() => onChange(page + 1)} aria-label={`Older ${label}`} className="btn btn-ghost min-h-9 px-3 text-xs disabled:opacity-50">Older</button>
    </div>
  </nav>;
}

export function PromotionManager({ plan }: { plan: SubscriptionPlan }) {
  const [offers, setOffers] = useState<Offers | null>(null);
  const [promo, setPromo] = useState<PromoForm>(emptyPromo);
  const [announcement, setAnnouncement] = useState<AnnouncementForm>(emptyAnnouncement);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [promoPage, setPromoPage] = useState(0);
  const [announcementPage, setAnnouncementPage] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ promo_page: String(promoPage), announcement_page: String(announcementPage) });
      const res = await fetch(`/api/admin/subscriptions/offers?${params}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (sequence !== loadSequence.current) return;
      if (!res.ok || !Array.isArray(body.promos) || !Array.isArray(body.announcements) ||
        typeof body.promos_has_more !== 'boolean' || typeof body.announcements_has_more !== 'boolean') throw new Error(body?.error?.message ?? 'Could not load offers.');
      setOffers(body as Offers); setError('');
    } catch (err) { if (sequence === loadSequence.current) setError(err instanceof Error ? err.message : 'Could not load offers.'); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [promoPage, announcementPage]);
  useEffect(() => {
    setOffers(null); void load();
    return () => { ++loadSequence.current; };
  }, [load]);

  const save = async (body: Record<string, unknown>, message: string) => {
    if (busy || loading) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/api/admin/subscriptions/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.error?.message ?? 'Could not save the offer.');
      setNotice(message); await load(); return true;
    } catch (err) { setError(err instanceof Error ? err.message : 'Connection interrupted. Reload offers before retrying.'); return false; }
    finally { setBusy(false); }
  };

  const savePromo = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const code = promo.code.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) throw new Error('Use 3–32 letters, numbers, hyphens or underscores for the code.');
      const value = promo.type === 'fixed' ? rupeesToPaise(promo.value) : /^\d+$/.test(promo.value) ? Number(promo.value) : null;
      if (value === null || !Number.isSafeInteger(value) || value < 1 || (promo.type === 'percent' && value > 100)) throw new Error(promo.type === 'percent' ? 'Enter a whole percentage from 1 to 100.' : 'Enter a positive rupee amount with at most two decimal places.');
      if (!promo.terms.length) throw new Error('Choose at least one eligible term.');
      const maxUses = readLimit(promo.total, 1_000_000), maxPerShop = readLimit(promo.perShop, 1000);
      const dates = dateRange(promo.starts, promo.ends);
      const couldBeFree = canBeFree(promo.type, value, promo.terms, plan);
      if (promo.enabled && couldBeFree && maxPerShop === null && !window.confirm('This code can make a term free and has no per-shop limit. A shop could activate it repeatedly while it remains available. Save it this way?')) return;
      const ok = await save({ action: 'save_promo', id: promo.id, expected_version: promo.version, promo: {
        code, discount_type: promo.type, discount_value: value, terms: promo.terms, ...dates,
        max_uses: maxUses, max_uses_per_shop: maxPerShop, enabled: promo.enabled,
      } }, 'Promo saved. Changes affect new requests only; existing requests keep their original amounts.');
      if (ok) setPromo(emptyPromo());
    } catch (err) { setError(err instanceof Error ? err.message : 'Check the promo details.'); }
  };
  const saveAnnouncement = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (!announcement.title.trim() || !announcement.message.trim()) throw new Error('Add a title and message for the announcement.');
      const code = announcement.promoCode.trim().toUpperCase();
      if (code && !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) throw new Error('Use a saved promo code with 3–32 letters, numbers, hyphens or underscores.');
      const dates = dateRange(announcement.starts, announcement.ends);
      const ok = await save({ action: 'save_announcement', id: announcement.id, expected_version: announcement.version, announcement: {
        title: announcement.title.trim(), message: announcement.message.trim(), promo_code: code || null,
        ...dates, enabled: announcement.enabled, public_visible: announcement.publicVisible,
      } }, 'Announcement saved. Linked offers appear only while the promo is available.');
      if (ok) setAnnouncement(emptyAnnouncement());
    } catch (err) { setError(err instanceof Error ? err.message : 'Check the announcement details.'); }
  };
  const editPromo = (item: SubscriptionPromo) => {
    setPromo({ id: item.id, version: item.version, code: item.code, type: item.discount_type,
      value: item.discount_type === 'fixed' ? paiseToInput(item.discount_value) : String(item.discount_value),
      terms: item.terms, starts: dateInput(item.starts_at), ends: dateInput(item.ends_at), total: item.max_uses == null ? '' : String(item.max_uses),
      perShop: item.max_uses_per_shop == null ? '' : String(item.max_uses_per_shop), enabled: item.enabled });
    setError(''); setNotice('');
  };
  const editAnnouncement = (item: SubscriptionAnnouncement) => {
    setAnnouncement({ id: item.id, version: item.version, title: item.title, message: item.message, promoCode: item.promo_code ?? '',
      starts: dateInput(item.starts_at), ends: dateInput(item.ends_at), enabled: item.enabled, publicVisible: item.public_visible });
    setError(''); setNotice('');
  };
  const togglePromo = (item: SubscriptionPromo) => {
    if (!window.confirm(`${item.enabled ? 'Pause' : 'Enable'} ${item.code}? Existing requests and granted periods will not change.`)) return;
    if (!item.enabled && item.max_uses_per_shop === null && canBeFree(item.discount_type, item.discount_value, item.terms, plan) &&
      !window.confirm('This code can make a term free and has no per-shop limit. A shop could activate it repeatedly. Enable it this way?')) return;
    void save({ action: 'save_promo', id: item.id, expected_version: item.version, promo: {
      code: item.code, discount_type: item.discount_type, discount_value: item.discount_value, terms: item.terms,
      starts_at: item.starts_at, ends_at: item.ends_at, max_uses: item.max_uses, max_uses_per_shop: item.max_uses_per_shop, enabled: !item.enabled,
    } }, `${item.code} ${item.enabled ? 'paused' : 'enabled'} for new requests.`);
  };
  const toggleAnnouncement = (item: SubscriptionAnnouncement) => {
    void save({ action: 'save_announcement', id: item.id, expected_version: item.version, announcement: {
      title: item.title, message: item.message, promo_code: item.promo_code, starts_at: item.starts_at, ends_at: item.ends_at,
      enabled: !item.enabled, public_visible: item.public_visible,
    } }, `Announcement ${item.enabled ? 'paused' : 'enabled'}.`);
  };

  return <section className="card overflow-hidden" aria-labelledby="offers-title">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 bg-indigo-50/50 p-5"><div><h2 id="offers-title" className="flex items-center gap-2 text-lg font-extrabold"><TicketPercent size={19} className="text-indigo-600" />Offers & announcements</h2><p className="mt-1 text-xs leading-5 text-neutral-600">Create codes and publish updates for shop owners and the public pricing page.</p></div><button type="button" onClick={() => void load()} disabled={busy || loading} className="btn btn-ghost min-h-10 px-3 text-xs"><RefreshCw size={14} />Reload offers</button></div>
    <div className="space-y-5 p-5">
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
      {!offers ? <p className="text-sm text-neutral-500">{error ? 'Offers are unavailable; retry before making changes.' : 'Loading offers…'}</p> : <>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><strong>Free activation:</strong> a 100% code or a fixed discount that covers the full term activates access immediately without payment or review. Set a per-shop limit to prevent repeat free renewals. Paid balances still require independent verification.</div>
        <form onSubmit={savePromo} className="space-y-4 rounded-2xl border border-neutral-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">{promo.id ? `Edit promo ${promo.code}` : 'Create a promo code'}</h3>{promo.id && <button type="button" onClick={() => setPromo(emptyPromo())} className="text-xs font-bold text-indigo-700 underline">Cancel editing</button>}</div>
          <div className="grid gap-3 sm:grid-cols-3"><label className={field}>Promo code<input className={`${control} font-mono uppercase`} value={promo.code} onChange={(event) => setPromo({ ...promo, code: event.target.value })} maxLength={32} placeholder="WELCOME20" required readOnly={!!promo.id} /></label><label className={field}>Discount type<select className={control} value={promo.type} onChange={(event) => setPromo({ ...promo, type: event.target.value as PromoForm['type'] })}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></label><label className={field}>{promo.type === 'percent' ? 'Percent off' : 'Amount off (₹)'}<input className={control} value={promo.value} inputMode={promo.type === 'percent' ? 'numeric' : 'decimal'} onChange={(event) => setPromo({ ...promo, value: event.target.value })} placeholder={promo.type === 'percent' ? '20' : '100.00'} required /></label></div>
          {promo.id && <p className="text-xs text-neutral-500">A saved code cannot be renamed. Create a new one instead.</p>}
          <fieldset><legend className={field}>Eligible terms</legend><div className="mt-2 flex flex-wrap gap-4">{SUBSCRIPTION_TERMS.map((term) => <label key={term.value} className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={promo.terms.includes(term.value)} onChange={(event) => setPromo({ ...promo, terms: event.target.checked ? [...promo.terms, term.value] : promo.terms.filter((value) => value !== term.value) })} />{term.label}</label>)}</div></fieldset>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className={field}>Promo starts at (IST)<input type="datetime-local" className={control} value={promo.starts} onChange={(event) => setPromo({ ...promo, starts: event.target.value })} /></label><label className={field}>Promo ends at (IST)<input type="datetime-local" className={control} value={promo.ends} onChange={(event) => setPromo({ ...promo, ends: event.target.value })} /></label><label className={field}>Total use limit<input type="number" min={1} max={1000000} className={control} value={promo.total} onChange={(event) => setPromo({ ...promo, total: event.target.value })} placeholder="No limit" /></label><label className={field}>Uses per shop<input type="number" min={1} max={1000} className={control} value={promo.perShop} onChange={(event) => setPromo({ ...promo, perShop: event.target.value })} placeholder="No limit" /></label></div>
          <p className="text-xs leading-5 text-neutral-500">Blank dates mean no start or end; blank limits mean unlimited. A paid request reserves a use until cancelled or rejected. Approved requests consume it. Percentage discounts round down to whole paise.</p>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={promo.enabled} onChange={(event) => setPromo({ ...promo, enabled: event.target.checked })} />Enabled for new requests</label>
          <button disabled={busy || loading} className="btn btn-primary min-h-11 px-5 text-sm">{promo.id ? 'Save promo changes' : 'Create promo code'}</button>
        </form>

        <div><h3 className="font-extrabold">Promo codes</h3><p className="mt-1 text-xs text-neutral-500">Newest first, 100 per page. Reserved uses include initiated and submitted payments.</p><div className="mt-3 space-y-2">{offers.promos.map((item) => <article key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-neutral-200 p-3"><div className="min-w-0"><p className="break-all text-sm font-extrabold"><span className="font-mono">{item.code}</span> <span className="ml-1 text-indigo-700">· {promoDescription(item)}</span> <span className="chip bg-neutral-100 text-neutral-700">{stateOf(item)}</span></p><p className="mt-1 text-xs text-neutral-600">{eligibleTerms(item.terms)} · {item.approved_uses} used + {item.reserved_uses} reserved{item.max_uses == null ? ' · no total limit' : ` / ${item.max_uses} total`} · {item.max_uses_per_shop == null ? 'no per-shop limit' : `${item.max_uses_per_shop} per shop`}</p>{item.ends_at && <p className="mt-1 text-xs text-neutral-500">Ends {subscriptionDate(item.ends_at)}</p>}</div><div className="flex gap-2"><button type="button" disabled={busy || loading} onClick={() => editPromo(item)} aria-label={`Edit promo ${item.code}`} className="btn btn-ghost min-h-9 px-3 text-xs"><Pencil size={13} />Edit</button><button type="button" disabled={busy || loading} onClick={() => togglePromo(item)} aria-label={`${item.enabled ? 'Pause' : 'Enable'} promo ${item.code}`} className="btn btn-ghost min-h-9 px-3 text-xs">{item.enabled ? 'Pause' : 'Enable'}</button></div></article>)}{!offers.promos.length && <p className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-500">{promoPage === 0 ? 'No promo codes yet.' : 'No promo codes on this page.'}</p>}</div><Pages label="promo codes" page={promoPage} hasMore={offers.promos_has_more} disabled={busy || loading} onChange={setPromoPage} /></div>

        <form onSubmit={saveAnnouncement} className="space-y-4 rounded-2xl border border-neutral-200 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-extrabold"><Megaphone size={17} className="text-indigo-600" />{announcement.id ? 'Edit announcement' : 'Create an announcement'}</h3>{announcement.id && <button type="button" onClick={() => setAnnouncement(emptyAnnouncement())} className="text-xs font-bold text-indigo-700 underline">Cancel editing</button>}</div>
          <div className="grid gap-3 sm:grid-cols-2"><label className={field}>Announcement title<input className={control} value={announcement.title} maxLength={100} required onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })} placeholder="A little thank-you for shops" /></label><label className={field}>Link a promo code (optional)<input className={`${control} font-mono uppercase`} list="saved-subscription-promos" value={announcement.promoCode} maxLength={32} onChange={(event) => setAnnouncement({ ...announcement, promoCode: event.target.value })} placeholder="Enter a saved code" /><datalist id="saved-subscription-promos">{offers.promos.map((item) => <option key={item.id} value={item.code} />)}</datalist></label></div>
          <label className={`block ${field}`}>Announcement message<textarea className={control} rows={3} value={announcement.message} maxLength={400} required onChange={(event) => setAnnouncement({ ...announcement, message: event.target.value })} placeholder="Tell shop owners about this update or offer." /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className={field}>Announcement starts at (IST)<input type="datetime-local" className={control} value={announcement.starts} onChange={(event) => setAnnouncement({ ...announcement, starts: event.target.value })} /></label><label className={field}>Announcement ends at (IST)<input type="datetime-local" className={control} value={announcement.ends} onChange={(event) => setAnnouncement({ ...announcement, ends: event.target.value })} /></label></div>
          <p className="text-xs leading-5 text-neutral-500">Enter any saved code, including an older one not in the suggestions. Its actual discount is shown automatically. The announcement hides when that promo is paused, expired or fully reserved. Use neutral message text so it stays accurate if you change the discount.</p>
          <div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={announcement.enabled} onChange={(event) => setAnnouncement({ ...announcement, enabled: event.target.checked })} />Announcement enabled</label><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={announcement.publicVisible} onChange={(event) => setAnnouncement({ ...announcement, publicVisible: event.target.checked })} />Show on public pricing page</label></div>
          <button disabled={busy || loading} className="btn btn-primary min-h-11 px-5 text-sm">{announcement.id ? 'Save announcement changes' : 'Create announcement'}</button>
        </form>
        <div><h3 className="font-extrabold">Announcements</h3><p className="mt-1 text-xs text-neutral-500">Newest first, 100 per page. Each surface shows up to 100 available in-window updates; public visibility is optional.</p><div className="mt-3 space-y-2">{offers.announcements.map((item) => <article key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-neutral-200 p-3"><div><p className="text-sm font-extrabold">{item.title} <span className="chip bg-neutral-100 text-neutral-700">{stateOf(item)}</span></p><p className="mt-1 text-xs text-neutral-600">{item.public_visible ? 'Shop + public pricing' : 'Shop only'}{item.promo_code ? ` · ${item.promo_code}` : ''}</p></div><div className="flex gap-2"><button type="button" disabled={busy || loading} onClick={() => editAnnouncement(item)} aria-label={`Edit announcement ${item.title}`} className="btn btn-ghost min-h-9 px-3 text-xs"><Pencil size={13} />Edit</button><button type="button" disabled={busy || loading} onClick={() => toggleAnnouncement(item)} aria-label={`${item.enabled ? 'Pause' : 'Enable'} announcement ${item.title}`} className="btn btn-ghost min-h-9 px-3 text-xs">{item.enabled ? 'Pause' : 'Enable'}</button></div></article>)}{!offers.announcements.length && <p className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-500">{announcementPage === 0 ? 'No announcements yet.' : 'No announcements on this page.'}</p>}</div><Pages label="announcements" page={announcementPage} hasMore={offers.announcements_has_more} disabled={busy || loading} onChange={setAnnouncementPage} /></div>
      </>}
    </div>
  </section>;
}
