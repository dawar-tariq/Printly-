// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShopApplicationStatus } from './ShopApplicationStatus';

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const base = { shopId: 'shop-1', shopStatus: 'paused', canAccessDashboard: false };

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);
describe('shop application status', () => {
  it('shows received and review and allows an explicit refresh', () => {
    render(<ShopApplicationStatus {...base} status="pending" />);
    expect(screen.getByText('Application received')).toBeTruthy();
    expect(screen.getByText('Under review').getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByText('Check status'));
    expect(router.refresh).toHaveBeenCalled();
  });
  it('celebrates approval but does not bypass a missing subscription', async () => {
    const { rerender } = render(<ShopApplicationStatus {...base} status="pending" />);
    rerender(<ShopApplicationStatus {...base} status="approved" shopStatus="active" />);
    await waitFor(() => expect(screen.getByText(/Congratulations/)).toBeTruthy());
    expect(screen.getByText(/active subscription is still required/)).toBeTruthy();
    fireEvent.click(screen.getByText('Continue'));
    expect(router.push).not.toHaveBeenCalled();
  });
  it('continues to the dashboard only if access is already granted', async () => {
    localStorage.setItem('printly-application-seen:shop-1', '1');
    render(<ShopApplicationStatus {...base} status="approved" shopStatus="active" canAccessDashboard />);
    await waitFor(() => expect(screen.getByText('Continue to dashboard')).toBeTruthy());
    fireEvent.click(screen.getByText('Continue to dashboard'));
    expect(router.push).toHaveBeenCalledWith('/shop');
    expect(localStorage.getItem('printly-application-seen:shop-1')).toBeNull();
  });
  it('does not celebrate a different shop or an already approved application', () => {
    localStorage.setItem('printly-application-seen:another-shop', '1');
    render(<ShopApplicationStatus {...base} status="approved" shopStatus="active" canAccessDashboard />);
    expect(screen.queryByText(/Congratulations/)).toBeNull();
  });
  it('does not claim approval when changes are requested or rejected', () => {
    const { rerender } = render(<ShopApplicationStatus {...base} status="changes_requested" reviewNote="Please update your proof." />);
    expect(screen.getByText('Please update your proof.')).toBeTruthy();
    rerender(<ShopApplicationStatus {...base} status="rejected" />);
    expect(screen.getByText('Application not approved')).toBeTruthy();
    expect(screen.queryByText(/Congratulations/)).toBeNull();
  });
});
