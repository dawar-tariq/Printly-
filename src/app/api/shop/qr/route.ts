import QRCode from 'qrcode';
import sharp from 'sharp';
import { qrBrandBadgeSvg } from '@/lib/qr-brand';
import { getStaffContext, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { publicShopPath } from '@/lib/shop-identity';

export async function GET(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return jsonError(403, 'forbidden', 'No shop');
  const admin = createAdminSupabase();
  const { data: shop } = await admin.from('shops').select('slug, short_code, name').eq('id', staff.shopIds[0]).single();
  if (!shop) return jsonError(404, 'not_found', 'Shop not found');

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const url = `${base.replace(/\/$/, '')}${publicShopPath(shop.short_code)}`;
  const size = 640;
  const code = await QRCode.toBuffer(url, {
    type: 'png', width: size, margin: 4,
    color: { dark: '#000000', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  });
  // Keep the link untouched: only a small, white-backed brand mark is placed
  // over the centre, with high error correction and the full quiet zone.
  const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${qrBrandBadgeSvg(0, 0, size)}</svg>`;
  const png = await sharp(code).composite([{ input: Buffer.from(badge) }]).png().toBuffer();
  const download = new URL(req.url).searchParams.get('download') === '1';
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      ...(download ? { 'Content-Disposition': `attachment; filename="printly-qr-${shop.short_code}.png"` } : {}),
    },
  });
}
