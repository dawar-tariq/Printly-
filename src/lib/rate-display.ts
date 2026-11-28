import type { RateRow } from '@/lib/pricing';

/** Human-readable billing basis, including the preserved legacy sheet unit. */
export function rateUnitLabel(unit: RateRow['unit'], service: string): string {
  if (unit === 'duplex_sheet') return 'physical duplex sheet';
  if (unit === 'job') return 'copy / set';
  if (unit === 'sheet') return service === 'laminate' ? 'sheet' : 'document page (legacy sheet rate)';
  return service === 'print' || service === 'photocopy' ? 'printed page' : 'page';
}
