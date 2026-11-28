import { describe, expect, it } from 'vitest';
import { indiaDateKey, shopReportPeriod } from './shop-report-period';

describe('shop reporting dates', () => {
  it('uses India midnight across the UTC date boundary', () => {
    const period = shopReportPeriod(1, new Date('2026-11-19T20:00:00Z'));
    expect(period.since).toBe('2026-11-19T18:30:00.000Z');
    expect(period.dates).toEqual([{ key: '2026-11-20', label: '20 Nov' }]);
    expect(indiaDateKey('2026-11-19T18:29:59Z')).toBe('2026-11-19');
    expect(indiaDateKey('2026-11-19T18:30:00Z')).toBe('2026-11-20');
  });
  it('builds a seven-day range in ascending local calendar days', () => {
    const period = shopReportPeriod(7, new Date('2026-01-02T08:00:00Z'));
    expect(period.since).toBe('2025-12-26T18:30:00.000Z');
    expect(period.dates.map((d) => d.key)).toEqual(['2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
  });
});
