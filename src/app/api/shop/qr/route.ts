import QRCode from 'qrcode';
import { getStaffContext, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return jsonError(403, 'forbidden', 'No shop');
  const admin = createAdminSupabase();
  const { data: shop } = await admin.from('shops').select('slug, short_code, name').eq('id', staff.shopIds[0]).single();
  if (!shop) return jsonError(404, 'not_found', 'Shop not found');

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const url = `${base}/s/${shop.slug}`;
  const png = await QRCode.toBuffer(url, {
    type: 'png', width: 640, margin: 2,
    color: { dark: '#1d1a16', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  });
  const download = new URL(req.url).searchParams.get('download') === '1';
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      ...(download ? { 'Content-Disposition': `attachment; filename="printly-qr-${shop.slug}.png"` } : {}),
    },
  });
}
