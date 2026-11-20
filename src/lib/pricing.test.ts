import { describe, it, expect } from 'vitest';
import { computeQuote, findRate, PricingError, type RateRow } from './pricing';

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
