import { NextResponse } from 'next/server';
import { assertStaffOfShop, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const admin = createAdminSupabase();
  const { data: file } = await admin.from('order_files').select('storage_path, shop_id, original_name').eq('id', fileId).eq('order_id', id).maybeSingle();
  if (!file) return jsonError(404, 'not_found', 'File not found');
  if (!await assertStaffOfShop(file.shop_id, { recoveryOrderId: id })) return jsonError(403, 'forbidden', 'Not your shop or order is unavailable');
  const { data, error } = await admin.storage.from('order-files').createSignedUrl(file.storage_path, 60, { download: file.original_name });
  if (error || !data) {
    console.error('Could not create a signed download:', error?.status);
    return jsonError(503, 'storage', 'Could not prepare the download. Please try again.');
  }
  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
