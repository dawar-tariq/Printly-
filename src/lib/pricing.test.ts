import { describe, it, expect } from 'vitest';
import { computeQuote, findRate, PricingError, qtyFor, type ItemSpec, type RateRow } from './pricing';

const card: RateRow[] = [
  { service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: 200 },
  { service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 90, option: null, unit: 'page', price_paise: 250 },
  { service: 'print', paper_size: 'A4', color: 'color', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: 1000 },
  { service: 'photocopy', paper_size: 'A4', color: 'bw', sides: null, paper_gsm: null, option: null, unit: 'page', price_paise: 150 },
  { service: 'bind', paper_size: null, color: null, sides: null, paper_gsm: null, option: 'spiral', unit: 'job', price_paise: 3000 },
];

describe('pricing engine', () => {
  it('prices pages × copies and picks the gsm-specific row', () => {
    const q = computeQuote([{ service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, copies: 2, pages: 12 }], card);
    expect(q.lines[0].qty).toBe(24);
    expect(q.lines[0].lineTotalPaise).toBe(4800);
  });

  it('falls back to a wilder row when exact gsm is missing', () => {
    const rate = findRate({ service: 'photocopy', paper_size: 'A4', color: 'bw', copies: 1, pages: 10 }, card);
    expect(rate.price_paise).toBe(150);
  });

  it('charges bind per job, not per page', () => {
    const q = computeQuote([{ service: 'bind', option: 'spiral', copies: 1, pages: 99 }], card);
    expect(q.lines[0].lineTotalPaise).toBe(3000);
  });

  it('applies rush fee before GST', () => {
    const q = computeQuote([{ service: 'photocopy', paper_size: 'A4', color: 'bw', copies: 1, pages: 100 }], card, { rush: true, rushBps: 1000, gstBps: 1800 });
    expect(q.subtotalPaise).toBe(15000);
    expect(q.rushFeePaise).toBe(1500);
    expect(q.taxPaise).toBe(Math.round((16500 * 1800) / 10000)); // 2970
    expect(q.totalPaise).toBe(16500 + 2970);
  });

  it('rounds half-up in integer paise', () => {
    const q = computeQuote([{ service: 'photocopy', paper_size: 'A4', color: 'bw', copies: 1, pages: 1 }], card, { gstBps: 1800 });
    expect(q.taxPaise).toBe(27); // 150 * 0.18 = 27
    expect(q.totalPaise).toBe(177);
  });

  it('throws a helpful error for unpriced services', () => {
    expect(() => computeQuote([{ service: 'scan', copies: 1, pages: 1 }], card)).toThrow(PricingError);
  });

  it('does not quote amounts that cannot fit the database money columns', () => {
    const expensive = [{ ...card[0], price_paise: 1_000_000 }];
    expect(() => computeQuote([{ service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, copies: 99, pages: 2000 }], expensive)).toThrow(/split it/i);
  });
});

describe('duplex pricing', () => {
  const duplex: ItemSpec = { file_id: 'file-a', service: 'print', paper_size: 'A4', color: 'bw', sides: 'duplex', paper_gsm: 80, copies: 1, pages: 5 };
  const perPage: RateRow = { ...card[0], sides: 'duplex', unit: 'page', price_paise: 150 };
  const perSheet: RateRow = { ...perPage, unit: 'duplex_sheet', price_paise: 300 };

  it.each([
    [1, 1, 1], [2, 1, 1], [3, 1, 2], [4, 1, 2], [5, 1, 3], [5, 2, 6], [2000, 99, 99000],
  ])('charges %i pages × %i copies as %i physical sheets', (pages, copies, sheets) => {
    const quote = computeQuote([{ ...duplex, pages, copies }], [perSheet], { gstBps: 0 });
    expect(quote.lines[0]).toMatchObject({ fileId: 'file-a', unit: 'duplex_sheet', qty: sheets, lineTotalPaise: sheets * 300 });
  });

  it('keeps per-printed-page charges for duplex, including an odd last page', () => {
    const quote = computeQuote([{ ...duplex, copies: 2 }], [perPage], { gstBps: 0 });
    expect(quote.lines[0]).toMatchObject({ unit: 'page', qty: 10, unitPricePaise: 150, lineTotalPaise: 1500 });
  });

  it('rounds sheets separately per file and per copy, never pairing across boundaries', () => {
    const quote = computeQuote([
      { ...duplex, pages: 5, copies: 2 },
      { ...duplex, file_id: 'file-b', pages: 1, copies: 2 },
    ], [perSheet], { gstBps: 0 });
    expect(quote.lines.map((line) => [line.fileId, line.qty, line.lineTotalPaise])).toEqual([
      ['file-a', 6, 1800], ['file-b', 2, 600],
    ]);
    expect(quote.subtotalPaise).toBe(2400);
  });

  it('supports photocopy with a specific duplex rate while retaining its wildcard fallback', () => {
    const anySide = { ...perPage, service: 'photocopy', sides: null, paper_gsm: null };
    const copySheet = { ...perSheet, service: 'photocopy' };
    const copy = { ...duplex, service: 'photocopy', copies: 2 };
    expect(computeQuote([copy], [anySide, copySheet], { gstBps: 0 }).lines[0].qty).toBe(6);
    expect(computeQuote([{ ...copy, sides: 'single' }], [anySide, copySheet], { gstBps: 0 }).lines[0].qty).toBe(10);
  });

  it('fails closed on an equally specific overlap involving a physical-sheet rate', () => {
    const broadSheet: RateRow = { ...perSheet, paper_gsm: null };
    const broadPage: RateRow = { ...perPage, sides: null };
    expect(() => computeQuote([duplex], [broadPage, broadSheet])).toThrow(/overlapping double-sided rates/i);
    expect(() => computeQuote([duplex], [broadSheet, broadPage])).toThrow(/overlapping double-sided rates/i);
    // A fully specified sheet rate has higher precedence than the wildcard.
    expect(computeQuote([duplex], [broadPage, perSheet], { gstBps: 0 }).lines[0].qty).toBe(3);
    // A card with only pre-existing units retains its original tie behaviour.
    expect(findRate(duplex, [broadPage, { ...broadSheet, unit: 'page', price_paise: 999 }]).price_paise).toBe(150);
  });

  it('does not reinterpret legacy sheet, page or job rates', () => {
    expect(qtyFor({ ...duplex, copies: 2 }, 'sheet')).toBe(10);
    expect(qtyFor({ ...duplex, copies: 2 }, 'page')).toBe(10);
    expect(qtyFor({ ...duplex, copies: 2 }, 'job')).toBe(2);
    const quote = computeQuote([{ ...duplex, copies: 2 }], [{ ...perSheet, unit: 'sheet' }], { gstBps: 0 });
    expect(quote.lines[0].lineTotalPaise).toBe(3000);
  });

  it('rejects a misconfigured physical-sheet rate rather than undercharging', () => {
    expect(() => qtyFor({ ...duplex, sides: 'single' }, 'duplex_sheet')).toThrow(PricingError);
    expect(() => qtyFor({ ...duplex, service: 'scan' }, 'duplex_sheet')).toThrow(PricingError);
    expect(() => qtyFor(duplex, 'unknown' as RateRow['unit'])).toThrow(PricingError);
  });

  it('continues to calculate rush and tax from the chosen sheet subtotal', () => {
    const quote = computeQuote([{ ...duplex, copies: 2 }], [perSheet], { rush: true, rushBps: 1000, gstBps: 1800 });
    expect(quote).toMatchObject({ subtotalPaise: 1800, rushFeePaise: 180, taxPaise: 356, totalPaise: 2336 });
  });
});
