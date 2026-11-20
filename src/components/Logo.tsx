import Link from 'next/link';
import { BrandArtwork, BrandMark } from '@/components/BrandArtwork';

export function Logo({ href = '/', inverse = false, compactOnMobile = false }: {
  href?: string;
  inverse?: boolean;
  compactOnMobile?: boolean;
}) {
  return (
    <Link href={href} aria-label="Printly" className="inline-flex shrink-0 items-center">
      {compactOnMobile && <BrandMark className="block h-8 w-8 sm:hidden" />}
      <BrandArtwork inverse={inverse} className={compactOnMobile ? 'hidden h-8 w-auto sm:block' : 'h-8 w-auto'} />
    </Link>
  );
}
