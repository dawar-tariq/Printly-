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
  const lines: QuoteLine[] = items.map((item) => {
    if (item.copies < 1 || item.pages < 1) throw new PricingError('copies and pages must be ≥ 1');
    const rate = findRate(item, card);
    const qty = qtyFor(item, rate.unit);
    const lineTotalPaise = rate.price_paise * qty;
    return {
      service: item.service,
      description: lineDescription(item, rate.unit),
      unit: rate.unit,
      unitPricePaise: rate.price_paise,
      qty,
      lineTotalPaise,
    };
  });
  const subtotalPaise = lines.reduce((a, l) => a + l.lineTotalPaise, 0);
  const rushFeePaise = opts.rush ? Math.round((subtotalPaise * rushBps) / 10000) : 0;
  const taxable = subtotalPaise + rushFeePaise;
  const taxPaise = Math.round((taxable * gstBps) / 10000);
  return { lines, subtotalPaise, rushFeePaise, taxPaise, totalPaise: taxable + taxPaise };
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
