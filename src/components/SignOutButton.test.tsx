// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => ({ auth: { signOut: mocks.signOut } }) }));
import { SignOutButton } from './SignOutButton';

beforeEach(() => { vi.clearAllMocks(); mocks.signOut.mockResolvedValue({ error: null }); });
afterEach(cleanup);

describe('signing out', () => {
  it.each(['shop', 'admin'] as const)('revokes only the current %s session on success', async (portal) => {
    render(<SignOutButton portal={portal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(portal === 'admin' ? '/admin/login' : '/login'));
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it('does not pretend the server revoked the session after a failure', async () => {
    mocks.signOut.mockResolvedValue({ error: { message: 'provider failure' } });
    render(<SignOutButton portal="shop" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be confirmed.*session may still be active/i);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
