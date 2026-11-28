import { Plus } from 'lucide-react';
import type { FaqItem } from '@/lib/marketing-faq';

export function FaqList({ items }: { items: FaqItem[] }) {
  return <div className="divide-y divide-[#e7e1da] border-y border-[#e7e1da]">
    {items.map((item) => <details id={item.id} key={item.id} className="group scroll-mt-28 py-1">
      <summary className="flex min-h-[72px] items-center justify-between gap-5 py-4 text-left text-[15px] font-bold text-[#2d2723] sm:text-base">
        <span>{item.question}</span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#e1d9d0] bg-white transition-colors group-open:border-[#edc4ad] group-open:bg-[#fff0e5]"><Plus size={16} className="transition-transform group-open:rotate-45" /></span>
      </summary>
      <p className="max-w-3xl pb-6 pr-12 text-sm leading-7 text-[#6b625b] sm:text-[15px]">{item.answer}</p>
    </details>)}
  </div>;
}
