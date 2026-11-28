// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReferralPreview } from './ReferralPreview';

afterEach(cleanup);
describe('referral preview', () => {
  it('clearly identifies the public page as an inactive preview and explains all milestones', () => {
    render(<ReferralPreview />);
    expect(screen.getByText(/referrals, rewards and payouts are not active yet/i)).toBeTruthy();
    expect(screen.getByText('Six months free')).toBeTruthy();
    expect(screen.getByText('Unlock 10% bonuses')).toBeTruthy();
    expect(screen.getByText('One year free in total')).toBeTruthy();
    expect(screen.getAllByText(/including earlier referrals/i)).toBeTruthy();
  });
  it('does not present a fake personal link in the owner preview', () => {
    render(<ReferralPreview owner />);
    expect(screen.getByText(/personal referral link not available yet/i)).toBeTruthy();
    expect(screen.getByText(/illustrative example · not your data/i)).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('7');
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });
});
