import { getStaffContext } from '@/lib/api';
import { OwnerHome } from '@/components/OwnerHome';

export default async function OwnerHomePage() {
  const staff = await getStaffContext({ allowExpired: true });
  const firstName = staff?.profile?.full_name?.trim().split(/\s+/)[0] ?? '';
  return <OwnerHome firstName={firstName} />;
}
