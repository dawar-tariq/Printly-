'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Store } from 'lucide-react';

/** The owner switch is not an override for verification or subscription. */
export function ShopAvailability({ initialOpen, isOwner }: { initialOpen: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setOpen(initialOpen); }, [initialOpen]);

  async function changeAvailability() {
    if (busy || uncertain || !isOwner) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/shop/availability', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_open: !open }), cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.is_open !== !open) {
        if (response.status >= 500 || response.ok) setUncertain(true);
        throw new Error(body?.error?.message ?? 'Could not confirm the change. Refresh before trying again.');
      }
      setOpen(body.is_open);
      router.refresh();
    } catch (err) {
      // A network failure can hide a successful change; never guess the state.
      setUncertain(true);
      setError(err instanceof Error ? err.message : 'Could not confirm the change. Refresh before trying again.');
    } finally { setBusy(false); }
  }

  return <section className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${open ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-amber-50'}`} aria-label="Shop availability">
    <div className="min-w-0">
      <p className={`flex items-center gap-2 text-sm font-extrabold ${open ? 'text-green-900' : 'text-amber-950'}`}><Store size={16} />{uncertain ? 'Shop status needs refresh' : open ? 'Shop setting: open' : 'Shop is closed'}</p>
      <p className="mt-1 text-xs text-neutral-700">{open ? 'Orders also require shop approval and an active subscription.' : 'New orders are stopped. Existing orders and started payments remain available.'}{!isOwner && ' Only the owner can change this setting.'}</p>
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-800">{error}</p>}
    </div>
    {uncertain ? <button type="button" onClick={() => window.location.reload()} className="btn btn-dark min-h-10 px-4 text-xs">Refresh status</button>
      : isOwner && <button type="button" disabled={busy} onClick={() => void changeAvailability()} className="btn btn-dark min-h-10 px-4 text-xs">{busy ? <Loader2 size={15} className="animate-spin" /> : open ? 'Close shop' : 'Reopen shop'}</button>}
  </section>;
}
