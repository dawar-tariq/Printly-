import Link from 'next/link';
import { Printer } from 'lucide-react';

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-extrabold tracking-tight text-xl">
      <span className="grid place-items-center w-8 h-8 rounded-xl bg-orange-600 text-white">
        <Printer size={18} strokeWidth={2.4} />
      </span>
      <span>Printly</span>
    </Link>
  );
}
