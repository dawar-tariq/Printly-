/** Printly pricing engine — pure, integer-paise, half-up rounding. */
export interface RateRow {
  service: string;
  paper_size: string | null;
  color: string | null;
  sides: string | null;
  paper_gsm: number | null;
  option: string | null;
  unit: 'page' | 'job' | 'sheet';
  price_paise: number;
}

export interface ItemSpec {
  service: string;
  paper_size?: string | null;
  color?: string | null;
  sides?: string | null;
  paper_gsm?: number | null;
  option?: string | null;
  copies: number;
  pages: number;
}

export interface QuoteLine {
  service: string;
  description: string;
  unit: RateRow['unit'];
  unitPricePaise: number;
  qty: number;
  lineTotalPaise: number;
}

export interface Quote {
  lines: QuoteLine[];
  subtotalPaise: number;
  rushFeePaise: number;
  taxPaise: number;
  totalPaise: number;
}

export class PricingError extends Error {}

// Monetary columns in Postgres are signed 32-bit integers. Refuse a quote that
// could not be stored exactly rather than displaying an unplaceable total.
const MAX_STORED_PAISE = 2_147_483_647;
function checkedPaise(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_STORED_PAISE) throw new PricingError('This order is too large to price. Please split it into smaller orders.');
  return value;
}

const OPTION_DIM_KEYS = ['paper_size', 'color', 'sides', 'paper_gsm'] as const;

function dimEquals(rowVal: string | number | null, itemVal: string | number | null | undefined): boolean {
  if (rowVal === null) return true; // wildcard matches anything
  return rowVal === (itemVal ?? null);
}

function rowSpecificity(row: RateRow): number {
  return OPTION_DIM_KEYS.reduce((acc, k) => acc + (row[k] !== null ? 1 : 0), 0);
}

export function findRate(item: ItemSpec, card: RateRow[]): RateRow {
  const serviceRows = card.filter((r) => r.service === item.service && (r.option ?? null) === (item.option ?? null));
  const matches = serviceRows.filter((r) => OPTION_DIM_KEYS.every((k) => dimEquals(r[k], item[k])));
  if (matches.length > 0) {
    return matches.sort((a, b) => rowSpecificity(b) - rowSpecificity(a))[0];
  }
  // widen: ignore sides, then gsm
  const relaxed = serviceRows.filter((r) =>
    dimEquals(r.paper_size, item.paper_size) && dimEquals(r.color, item.color) && r.sides === null && r.paper_gsm === null,
  );
  if (relaxed.length > 0) return relaxed.sort((a, b) => rowSpecificity(b) - rowSpecificity(a))[0];
  const wildcard = serviceRows.filter((r) => OPTION_DIM_KEYS.every((k) => r[k] === null));
  if (wildcard.length > 0) return wildcard[0];
  throw new PricingError(`No rate configured for service "${item.service}"${item.option ? ` (${item.option})` : ''}`);
}

export function qtyFor(item: ItemSpec, unit: RateRow['unit']): number {
  if (unit === 'job') return Math.max(1, item.copies);
  return Math.max(1, item.pages) * Math.max(1, item.copies); // page & sheet
}

export function computeQuote(
  items: ItemSpec[],
  card: RateRow[],
  opts: { rush?: boolean; rushBps?: number; gstBps?: number } = {},
): Quote {
  const rushBps = opts.rushBps ?? 1000;
  const gstBps = opts.gstBps ?? 1800;
  if (![rushBps, gstBps].every((value) => Number.isInteger(value) && value >= 0 && value <= 5000)) throw new PricingError('The shop’s pricing settings need to be checked.');
  const lines: QuoteLine[] = items.map((item) => {
    if (!Number.isInteger(item.copies) || !Number.isInteger(item.pages) || item.copies < 1 || item.pages < 1) throw new PricingError('copies and pages must be whole numbers ≥ 1');
    const rate = findRate(item, card);
    const qty = qtyFor(item, rate.unit);
    checkedPaise(rate.price_paise);
    const lineTotalPaise = checkedPaise(rate.price_paise * qty);
    return {
      service: item.service,
      description: lineDescription(item, rate.unit),
      unit: rate.unit,
      unitPricePaise: rate.price_paise,
      qty,
      lineTotalPaise,
    };
  });
  const subtotalPaise = checkedPaise(lines.reduce((a, l) => a + l.lineTotalPaise, 0));
  const rushFeePaise = opts.rush ? checkedPaise(Math.round((subtotalPaise * rushBps) / 10000)) : 0;
  const taxable = checkedPaise(subtotalPaise + rushFeePaise);
  const taxPaise = checkedPaise(Math.round((taxable * gstBps) / 10000));
  return { lines, subtotalPaise, rushFeePaise, taxPaise, totalPaise: checkedPaise(taxable + taxPaise) };
}

function lineDescription(item: ItemSpec, unit: RateRow['unit']): string {
  if (item.service === 'bind') return `Binding — ${item.option ?? 'none'}`;
  if (item.service === 'laminate') return `Lamination ${item.paper_size ?? ''}`.trim();
  const bits = [
    item.paper_size,
    item.color === 'color' ? 'Color' : 'B&W',
    item.sides === 'duplex' ? 'Duplex' : null,
    unit === 'page' ? `${item.pages}p × ${item.copies}` : `× ${item.copies}`,
  ].filter(Boolean);
  const label = item.service === 'photocopy' ? 'Photocopy' : item.service === 'scan' ? 'Scan' : 'Print';
  return `${label} — ${bits.join(', ')}`;
}

export function commissionPaise(totalPaise: number, commissionBps: number): number {
  return Math.round((totalPaise * commissionBps) / 10000);
}
