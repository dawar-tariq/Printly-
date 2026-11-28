import { notFound } from 'next/navigation';
import { PublicShell } from '@/components/marketing/PublicShell';
import { ReferralPreview } from '@/components/ReferralPreview';

export const dynamic = 'force-dynamic';
export default function ReferralPage() {
  if (process.env.PRINTLY_ISOLATED_TEST !== '1') notFound();
  return <PublicShell><ReferralPreview /></PublicShell>;
}
