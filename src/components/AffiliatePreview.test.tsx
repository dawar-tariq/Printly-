// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AffiliatePreview } from './AffiliatePreview';

afterEach(cleanup);
describe('affiliate preview', () => {
  it('explains the recurring commission and does not pretend signup is active', () => {
    render(<AffiliatePreview />);
    expect(screen.getByText(/registration, tracking, commissions and payouts are not active/i)).toBeTruthy();
    expect(screen.getAllByText(/including renewals/i)).toBeTruthy();
    expect(screen.getByText(/Google login is not being added yet/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /join|sign up/i })).toBeNull();
  });
  it('does not offer fake admin payout or configuration actions', () => {
    render(<AffiliatePreview admin />);
    expect(screen.getByText(/No payment data or live ledger exists/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pay|save/i })).toBeNull();
  });
});
