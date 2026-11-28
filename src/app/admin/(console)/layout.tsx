import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/api';
import { AdminShell } from '@/components/AdminShell';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionProfile();
  if (!session) redirect('/admin/login?next=/admin');
  if (session.profile?.role !== 'admin') redirect('/shop');
  return <AdminShell>{children}</AdminShell>;
}
