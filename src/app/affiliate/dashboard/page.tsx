import { notFound } from 'next/navigation';
import { AffiliateDashboardPreview } from '@/components/AffiliateDashboardPreview';

export const dynamic = 'force-dynamic';
export default function AffiliateDashboardPage() {
  if (process.env.PRINTLY_ISOLATED_TEST !== '1') notFound();
  return <AffiliateDashboardPreview />;
}
