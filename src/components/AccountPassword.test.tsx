// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), signIn: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => ({
  auth: { getUser: mocks.getUser, signInWithPassword: mocks.signIn, updateUser: mocks.updateUser },
}) }));
import { AccountPassword } from './AccountPassword';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { email: 'shop@example.com' } }, error: null });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
});
afterEach(cleanup);

function fill(current: string, password: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password (at least 12 characters)'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
}

describe('account password changes', () => {
  it('lets a shop owner change only their own password after verifying the current one', async () => {
    render(<AccountPassword portal="shop" />);
    expect(screen.getByText('Shop account password')).toBeTruthy();
    fill('old-password', 'new-password-123', 'new-password-123');
    fireEvent.click(screen.getByRole('button', { name: 'Change shop password' }));
    await screen.findByText('Password updated. Keep it private and store it safely.');
    expect(mocks.signIn).toHaveBeenCalledWith({ email: 'shop@example.com', password: 'old-password' });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'new-password-123' });
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
  });
  it('does not change an admin password when confirmation differs', async () => {
    render(<AccountPassword portal="admin" />);
    expect(screen.getByText('Administrator password')).toBeTruthy();
    fill('old-password', 'new-password-123', 'different-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change admin password' }));
    await screen.findByText('The new passwords do not match.');
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('does not update the password when the current password is wrong', async () => {
    mocks.signIn.mockResolvedValue({ error: new Error('Invalid login') });
    render(<AccountPassword portal="shop" />);
    fill('wrong-password', 'new-password-123', 'new-password-123');
    fireEvent.click(screen.getByRole('button', { name: 'Change shop password' }));
    await screen.findByText('Current password is incorrect.');
    await waitFor(() => expect(mocks.updateUser).not.toHaveBeenCalled());
  });
});
