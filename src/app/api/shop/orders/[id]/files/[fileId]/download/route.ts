import { assertStaffOfShop, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const admin = createAdminSupabase();
  const { data: file } = await admin.from('order_files').select('storage_path, shop_id, original_name').eq('id', fileId).eq('order_id', id).maybeSingle();
  if (!file) return jsonError(404, 'not_found', 'File not found');
  const staff = await assertStaffOfShop(file.shop_id);
  if (!staff) return jsonError(403, 'forbidden', 'Not your shop');

  const { data, error } = await admin.storage.from('order-files').createSignedUrl(file.storage_path, 60);
  if (error || !data) return jsonError(500, 'storage', error?.message ?? 'Could not sign URL');
  return Response.redirect(data.signedUrl, 302);
}
