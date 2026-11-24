import { redirect } from 'next/navigation';
import { getStaffContext } from '@/lib/api';
import { RestrictedShopShell } from '@/components/RestrictedShopShell';

export const dynamic = 'force-dynamic';

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff) redirect('/login?next=/shop/subscription');
  if (staff.isAdmin) redirect('/admin');
  if (staff.membershipError) return <div className="grid min-h-screen place-items-center px-6 text-center"><div className="card p-8"><h1 className="text-xl font-extrabold">Can’t check shop access right now</h1><p className="mt-2 text-sm text-neutral-600">Please try again.</p><a className="btn btn-dark mt-4 min-h-10 px-4" href="/shop/subscription">Try again</a></div></div>;
  if (!staff.shopIds.length) redirect('/shop');
  const [{ data: shop }, { data: plan }] = await Promise.all([
    staff.admin.from('shops').select('id, name, owner_id, is_open').eq('id', staff.shopIds[0]).maybeSingle(),
    staff.admin.from('subscription_plan').select('warning_days').eq('id', true).maybeSingle(),
  ]);
  return <RestrictedShopShell isOpen={shop?.is_open} shopName={shop?.name ?? 'Your shop'} active={staff.activeShopIds.includes(staff.shopIds[0])} subscription={staff.subscriptions.find((s) => s.shop_id === staff.shopIds[0]) ?? null} warningDays={plan?.warning_days ?? 7} isOwner={shop?.owner_id === staff.user.id}>{children}</RestrictedShopShell>;
}
