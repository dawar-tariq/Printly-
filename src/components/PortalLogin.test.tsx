// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), profile: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => ({
  auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
}) }));
import { PortalLogin } from './PortalLogin';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signIn.mockResolvedValue({ data: { user: { id: 'admin-id' } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(cleanup);

function submit() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('separate shop and admin sign-in', () => {
  it('takes an administrator directly to the admin console', async () => {
    mocks.profile.mockResolvedValue({ data: { role: 'admin' }, error: null });
    render(<PortalLogin portal="admin" />);
    expect(screen.getByText('Admin sign in')).toBeTruthy();
    expect(screen.queryByText(/Apply to join/)).toBeNull();
    submit();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin'));
  });
  it('routes an admin who used the old shop-login URL to the admin console', async () => {
    mocks.profile.mockResolvedValue({ data: { role: 'admin' }, error: null });
    render(<PortalLogin portal="shop" />);
    expect(screen.getByRole('link', { name: 'Apply to join Printly' }).getAttribute('href')).toBe('/shop/signup');
    submit();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin'));
  });
  it('refuses shop accounts in the admin portal', async () => {
    mocks.profile.mockResolvedValue({ data: { role: 'shop_staff' }, error: null });
    render(<PortalLogin portal="admin" />);
    submit();
    await screen.findByText('This account does not have administrator access.');
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
