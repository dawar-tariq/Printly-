// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AffiliateDashboardPreview } from './AffiliateDashboardPreview';

afterEach(cleanup);
describe('affiliate dashboard preview', () => {
  it('labels sample earnings and unfinished account tools clearly', () => {
    render(<AffiliateDashboardPreview />);
    expect(screen.getByText(/all figures below are examples/i)).toBeTruthy();
    expect(screen.getByText('Awaiting payout')).toBeTruthy();
    expect(screen.getByText('Paid to you')).toBeTruthy();
    expect(screen.getByText(/email sign-in and registration are being built/i)).toBeTruthy();
    expect(screen.getByText(/personal link will appear here/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy|pay|sign in/i })).toBeNull();
  });
});
