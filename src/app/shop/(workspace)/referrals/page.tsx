import { notFound } from 'next/navigation';
import { ReferralPreview } from '@/components/ReferralPreview';

export const dynamic = 'force-dynamic';
export default function OwnerReferralsPage() {
  if (process.env.PRINTLY_ISOLATED_TEST !== '1') notFound();
  return <ReferralPreview owner />;
}
