import { printlyMarkGroup } from '@/lib/brand';

// A deliberately small badge limits the covered modules. All branded codes use
// high error correction and retain an uninterrupted four-module quiet zone.
export const QR_BRAND_BADGE_FRACTION = 0.14;
export const QR_BRAND_MARK_FRACTION = 0.72;

const number = (value: number) => Number(value.toFixed(6)).toString();

export function qrBrandBadgeBox(x: number, y: number, qrSize: number) {
  const size = qrSize * QR_BRAND_BADGE_FRACTION;
  return { x: x + (qrSize - size) / 2, y: y + (qrSize - size) / 2, size };
}

/** A white-backed, centred Printly mark, usable in any SVG coordinate system. */
export function qrBrandBadgeSvg(x: number, y: number, qrSize: number): string {
  const badge = qrBrandBadgeBox(x, y, qrSize);
  const markSize = badge.size * QR_BRAND_MARK_FRACTION;
  const inset = (badge.size - markSize) / 2;
  return `<g data-brand-qr="true"><rect x="${number(badge.x)}" y="${number(badge.y)}" width="${number(badge.size)}" height="${number(badge.size)}" rx="${number(badge.size * 0.16)}" fill="#ffffff"/>${printlyMarkGroup(badge.x + inset, badge.y + inset, markSize)}</g>`;
}
