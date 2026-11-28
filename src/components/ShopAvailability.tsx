'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import styles from './ShopAvailability.module.css';

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

  return <section className={`${styles.control} ${uncertain ? styles.unknown : open ? styles.open : styles.closed}`} aria-label="Shop availability">
    <div className={styles.row}>
      <span className={styles.status}><span className={styles.dot} aria-hidden="true" />{uncertain ? 'Status unconfirmed' : open ? 'Shop open' : 'Shop closed'}</span>
      {uncertain ? <button type="button" onClick={() => window.location.reload()} className={styles.action}>Refresh status</button>
        : isOwner && <button type="button" disabled={busy} onClick={() => void changeAvailability()} className={styles.action}>{busy ? <><Loader2 size={14} className="animate-spin" /> Updating</> : open ? 'Close shop' : 'Reopen shop'}</button>}
      <details className={styles.details}><summary aria-label="About shop availability">Info</summary><p>{open ? 'Orders also require shop approval and an active subscription.' : 'New orders are stopped. Existing orders and started payments remain available.'}{!isOwner && ' Only the owner can change this setting.'}</p></details>
    </div>
    {error && <p role="alert" className={styles.error}>{error} Refresh before trying again.</p>}
  </section>;
}
