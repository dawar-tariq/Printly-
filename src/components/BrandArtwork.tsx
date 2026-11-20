import {
  PRINTLY_INK, PRINTLY_LOGO_VIEWBOX, PRINTLY_MARK_PATH, PRINTLY_MARK_VIEWBOX,
  PRINTLY_ORANGE, PRINTLY_WORDMARK_PATH,
} from '@/lib/brand';

/** The same vector artwork is used on screen, on QR codes and in print exports. */
export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox={PRINTLY_MARK_VIEWBOX} width="32" height="32" className={className} aria-hidden="true" focusable="false">
      <path d={PRINTLY_MARK_PATH} fill={PRINTLY_ORANGE} fillRule="evenodd" />
    </svg>
  );
}

export function BrandArtwork({ inverse = false, className = 'h-8 w-auto' }: { inverse?: boolean; className?: string }) {
  return (
    <svg viewBox={PRINTLY_LOGO_VIEWBOX} width="114" height="32" className={className} aria-hidden="true" focusable="false">
      <path d={PRINTLY_MARK_PATH} fill={PRINTLY_ORANGE} fillRule="evenodd" />
      <path d={PRINTLY_WORDMARK_PATH} fill={inverse ? '#ffffff' : PRINTLY_INK} fillRule="evenodd" />
    </svg>
  );
}
