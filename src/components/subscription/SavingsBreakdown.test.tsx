// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SavingsBreakdown } from './SavingsBreakdown';

afterEach(cleanup);

it('labels a higher term price as a premium, including in recorded history', () => {
  render(<SavingsBreakdown base={70000} reference={60000} discount={5000} compact />);
  const comparison = screen.getByText(/Recorded comparison/).textContent ?? '';
  expect(comparison).toContain('term premium: ₹100 more than monthly');
  expect(comparison).toContain('promo savings: ₹50');
  expect(comparison).toContain('extra cost vs monthly: ₹50 more than monthly');
  expect(comparison).not.toContain('term savings');
});
