import QRCode from 'qrcode';
import sharp from 'sharp';
import { qrBrandBadgeSvg } from '@/lib/qr-brand';
import { getStaffContext, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { standeeOrderUrl } from '@/lib/standee/shared';
import { cachedPublicShopQr, cachePublicShopQr } from '@/lib/public-qr-cache';

export async function GET(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return jsonError(403, 'forbidden', 'No shop');
  const admin = createAdminSupabase();
  const { data: shop } = await admin.from('shops').select('slug, short_code, name').eq('id', staff.shopIds[0]).single();
  if (!shop) return jsonError(404, 'not_found', 'Shop not found');

  // Never encode an untrusted Host header into a shop's printable QR code.
  // The standee validator enforces a configured canonical origin and shop code.
  let url: string;
  try { url = standeeOrderUrl(process.env.NEXT_PUBLIC_SITE_URL, shop.short_code).replace(/\/order$/, ''); }
  catch { return jsonError(503, 'site_url', 'The shop URL is not configured correctly.'); }
  // Membership and the current canonical link are always checked above. Only
  // the derived, public QR artwork can be cached; never cache shop access,
  // orders, payments, customer details or availability.
  let png = await cachedPublicShopQr(url);
  if (!png) {
    const size = 640;
    const code = await QRCode.toBuffer(url, {
      type: 'png', width: size, margin: 4,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    });
    // Keep the link untouched: only a small, white-backed brand mark is placed
    // over the centre, with high error correction and the full quiet zone.
    const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${qrBrandBadgeSvg(0, 0, size)}</svg>`;
    png = await sharp(code).composite([{ input: Buffer.from(badge) }]).png().toBuffer();
    await cachePublicShopQr(url, png);
  }
  const download = new URL(req.url).searchParams.get('download') === '1';
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      ...(download ? { 'Content-Disposition': `attachment; filename="printly-qr-${shop.short_code}.png"` } : {}),
    },
  });
}
