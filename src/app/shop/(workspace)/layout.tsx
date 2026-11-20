import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getStaffContext } from '@/lib/api';
import { ShopShell } from '@/components/ShopShell';
import { createAdminSupabase } from '@/lib/supabase';
import { Store } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaffContext();
  if (!staff) redirect('/login?next=/shop');
  if (staff.isAdmin) redirect('/admin');

  if (staff.shopIds.length === 0) {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div className="card max-w-md p-8">
          <Store size={40} className="mx-auto text-orange-600" />
          <h1 className="mt-4 text-2xl font-extrabold">No shop linked yet</h1>
          <p className="mt-2 text-sm text-neutral-600">Your account isn’t linked to a shop. If you applied, we’re verifying it — you’ll be notified within 24–48h.</p>
          {staff.isAdmin && <Link href="/admin" className="btn btn-dark h-11 px-6 mt-5 inline-flex">Open admin console</Link>}
          {!staff.isAdmin && <Link href="/shop/signup" className="btn btn-primary h-11 px-6 mt-5 inline-flex">Apply for your shop</Link>}
        </div>
      </div>
    );
  }

  const admin = createAdminSupabase();
  const [{ data: shop }, { data: onboarding }] = await Promise.all([
    admin.from('shops').select('id, name, slug, short_code, kyc_status, status').eq('id', staff.shopIds[0]).single(),
    admin.from('shop_onboarding').select('review_note').eq('shop_id', staff.shopIds[0]).maybeSingle(),
  ]);
  if (!shop) redirect('/login?next=/shop');
  return <ShopShell shop={shop} reviewNote={onboarding?.review_note ?? ''}>{children}</ShopShell>;
}
