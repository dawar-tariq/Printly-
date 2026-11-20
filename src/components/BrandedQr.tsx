import { BrandMark } from '@/components/BrandArtwork';
import { QR_BRAND_BADGE_FRACTION, QR_BRAND_MARK_FRACTION } from '@/lib/qr-brand';

/** A central mark is shown only when the code uses high error correction. */
export function BrandedQr({ src, alt, brandInside = true }: { src: string; alt: string; brandInside?: boolean }) {
  const badgePercent = QR_BRAND_BADGE_FRACTION * 100;
  const markPercent = QR_BRAND_MARK_FRACTION * 100;
  return (
    <div className="relative mx-auto h-56 w-56 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="block h-full w-full" />
      {brandInside && <span aria-hidden="true" className="absolute grid place-items-center bg-white" style={{
        width: `${badgePercent}%`, height: `${badgePercent}%`,
        left: `${(100 - badgePercent) / 2}%`, top: `${(100 - badgePercent) / 2}%`, borderRadius: '16%',
      }}>
        <span style={{ width: `${markPercent}%`, height: `${markPercent}%` }}><BrandMark className="block h-full w-full" /></span>
      </span>}
    </div>
  );
}
