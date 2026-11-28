import { notFound } from 'next/navigation';
import { PublicShell } from '@/components/marketing/PublicShell';
import { AffiliatePreview } from '@/components/AffiliatePreview';

export const dynamic = 'force-dynamic';
export default function AffiliatePage() {
  if (process.env.PRINTLY_ISOLATED_TEST !== '1') notFound();
  return <PublicShell><AffiliatePreview /></PublicShell>;
}
