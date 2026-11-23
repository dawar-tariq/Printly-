'use client';
import type { CustomerLanguage } from '@/lib/customer-language';

export function CustomerLanguagePicker({ language, onChange }: { language: CustomerLanguage; onChange: (value: CustomerLanguage) => void }) {
  return <label className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-neutral-700">
    <span className="sr-only">Language / भाषा / زبان</span>
    <select aria-label="Language / भाषा / زبان" value={language} onChange={(event) => onChange(event.target.value as CustomerLanguage)} className="min-h-10 max-w-28 rounded-lg border border-neutral-300 bg-white px-2 text-xs">
      <option value="en">English</option><option value="hi">हिंदी</option><option value="ur">اردو</option>
    </select>
  </label>;
}
