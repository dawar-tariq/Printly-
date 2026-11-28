import { notFound } from 'next/navigation';
import { AffiliatePreview } from '@/components/AffiliatePreview';

export const dynamic = 'force-dynamic';
export default function AdminAffiliatesPage() {
  if (process.env.PRINTLY_ISOLATED_TEST !== '1') notFound();
  return <AffiliatePreview admin />;
}
