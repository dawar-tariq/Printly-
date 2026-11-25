'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { CustomerLanguage } from '@/lib/customer-language';

const words = {
  en: { label: 'Order ID', copy: 'Copy order ID', copied: 'Copied', failed: 'Could not copy; select the ID to copy it.', help: 'Anyone with this ID can view tracking. Share it only with the shop or Printly support.' },
  hi: { label: 'ऑर्डर ID', copy: 'ऑर्डर ID कॉपी करें', copied: 'कॉपी हो गया', failed: 'कॉपी नहीं हुआ; ID चुनकर कॉपी करें।', help: 'इस ID से कोई भी ट्रैकिंग देख सकता है। इसे केवल दुकान या Printly सहायता से साझा करें।' },
  ur: { label: 'آرڈر ID', copy: 'آرڈر ID کاپی کریں', copied: 'کاپی ہو گیا', failed: 'کاپی نہیں ہوا؛ ID منتخب کر کے کاپی کریں۔', help: 'اس ID سے کوئی بھی ٹریکنگ دیکھ سکتا ہے۔ اسے صرف دکان یا Printly مدد سے شیئر کریں۔' },
} as const;

/** The tracking ID is a bearer capability: show it only on the relevant order. */
export function OrderReference({ id, language = 'en' }: { id: string; language?: CustomerLanguage }) {
  const text = words[language];
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(id);
      setState('copied');
    } catch { setState('failed'); }
  };
  return <div className="rounded-xl border border-orange-100 bg-orange-50/60 p-3 text-left" dir="auto">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-extrabold uppercase tracking-wide text-neutral-600">{text.label}</span>
      <button type="button" onClick={() => void copy()} aria-label={text.copy} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-orange-800 hover:bg-orange-100">
        {state === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {state === 'copied' ? text.copied : text.copy}
      </button>
    </div>
    <code dir="ltr" className="block select-all break-all text-sm font-semibold text-neutral-900">{id}</code>
    <p className="mt-1 text-xs leading-relaxed text-neutral-600">{text.help}</p>
    {state === 'failed' && <p role="status" className="mt-1 text-xs text-red-700">{text.failed}</p>}
  </div>;
}
