import { describe, expect, it } from 'vitest';
import { rateUnitLabel } from './rate-display';

describe('customer billing labels', () => {
  it('distinguishes physical duplex sheets from document pages and preserved legacy units', () => {
    expect(rateUnitLabel('duplex_sheet', 'print')).toBe('physical duplex sheet');
    expect(rateUnitLabel('page', 'photocopy')).toBe('printed page');
    expect(rateUnitLabel('sheet', 'print')).toBe('document page (legacy sheet rate)');
    expect(rateUnitLabel('sheet', 'laminate')).toBe('sheet');
    expect(rateUnitLabel('job', 'bind')).toBe('copy / set');
  });
});
