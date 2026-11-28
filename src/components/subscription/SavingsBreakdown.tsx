import { formatPaiseExact } from '@/lib/format';
import { subscriptionSavings } from '@/lib/subscription-offers';

/** Comparisons use the monthly price snapshotted at request time, never today's price for an old purchase. */
export function SavingsBreakdown({ base, reference, discount, compact = false }: {
  base: number | null | undefined; reference: number | null | undefined; discount: number | null | undefined; compact?: boolean;
}) {
  const savings = subscriptionSavings(base, reference, discount ?? 0);
  if (!savings) return compact ? <p className="mt-1 text-xs text-neutral-500">Savings were not recorded for this older request.</p> : null;
  const term = savings.termDifference;
  const combined = savings.combinedDifference;
  const termText = term === null ? 'Unavailable' : term < 0 ? `${formatPaiseExact(-term)} more than monthly` : formatPaiseExact(term);
  const combinedText = combined === null ? 'Unavailable' : combined < 0 ? `${formatPaiseExact(-combined)} more than monthly` : formatPaiseExact(combined);
  if (compact) return <p className="mt-1 text-xs leading-5 text-neutral-600">Recorded comparison — {term != null && term < 0 ? 'term premium' : 'term savings'}: {termText} · promo savings: {formatPaiseExact(savings.promoSavings)} · {combined != null && combined < 0 ? 'extra cost' : 'total savings'} vs monthly: {combinedText}</p>;
  return <div className="space-y-2 text-sm">
    <div className="flex justify-between gap-4"><span className="text-neutral-600">Monthly equivalent</span><span className="font-semibold">{savings.reference == null ? 'Unavailable' : formatPaiseExact(savings.reference)}</span></div>
    <div className="flex justify-between gap-4"><span className="text-neutral-600">{term != null && term < 0 ? 'Term premium vs monthly' : 'Term savings vs monthly'}</span><span className="text-right font-semibold">{termText}</span></div>
    <div className="flex justify-between gap-4"><span className="text-neutral-600">Promo savings</span><span className="font-semibold">{formatPaiseExact(savings.promoSavings)}</span></div>
    <div className="flex justify-between gap-4 border-t border-neutral-200 pt-2"><span className="font-bold">{combined != null && combined < 0 ? 'Extra cost vs monthly' : 'Total savings vs monthly'}</span><span className={`text-right font-extrabold ${combined != null && combined > 0 ? 'text-emerald-700' : ''}`}>{combinedText}</span></div>
    {savings.reference === null && <p className="text-xs leading-5 text-neutral-500">A monthly comparison is unavailable because the monthly price was not configured.</p>}
  </div>;
}
