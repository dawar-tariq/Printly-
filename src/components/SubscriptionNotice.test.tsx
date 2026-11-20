// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import { SubscriptionNotice } from './SubscriptionNotice';

beforeEach(() => { sessionStorage.clear(); router.replace.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('subscription reminders', () => {
  it('shows the owner a prominent banner and a once-per-session renewal popup', () => {
    const subscription = { shop_id: 'shop', term: 'monthly' as const, started_at: '2026-01-01T00:00:00Z', expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), is_permanent: false };
    const props = { subscription, warningDays: 7, isOwner: true };
    const view = render(<SubscriptionNotice {...props} />);
    expect(screen.getByRole('status').textContent).toContain('Subscription expires in 3 days');
    expect(screen.getByRole('dialog').textContent).toContain('renewal is not automatic');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    render(<SubscriptionNotice {...props} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not show the owner-only reminder to staff and redirects on expiry', () => {
    const subscription = { shop_id: 'shop', term: 'yearly' as const, started_at: '2020-01-01T00:00:00Z', expires_at: '2020-12-31T00:00:00Z', is_permanent: false };
    render(<SubscriptionNotice subscription={subscription} warningDays={7} isOwner={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/shop/subscription');
  });
  it('locks an already-open dashboard at the expiry instant', () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-01-01T00:00:00Z'); vi.setSystemTime(start);
      render(<SubscriptionNotice subscription={{ shop_id: 'shop', term: 'monthly', started_at: '2025-12-01T00:00:00Z', expires_at: new Date(start.getTime() + 500).toISOString(), is_permanent: false }} warningDays={7} isOwner={false} />);
      expect(router.replace).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(515); });
      expect(router.replace).toHaveBeenCalledWith('/shop/subscription');
    } finally { vi.useRealTimers(); }
  });
  it('refreshes an open workspace when permanent access is revoked', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const fetchStatus = vi.fn(async () => ({ ok: true, json: async () => ({ subscription: { shop_id: 'shop', term: null, started_at: null, expires_at: null, is_permanent: false }, warning_days: 7 }) }));
      vi.stubGlobal('fetch', fetchStatus);
      render(<SubscriptionNotice subscription={{ shop_id: 'shop', term: null, started_at: null, expires_at: null, is_permanent: true }} warningDays={7} isOwner={false} />);
      expect(router.replace).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(fetchStatus).toHaveBeenCalledWith('/api/shop/subscription/status?shop_id=shop', { cache: 'no-store' });
      expect(router.replace).toHaveBeenCalledWith('/shop/subscription');
    } finally { vi.useRealTimers(); }
  });
  it('does not lock at the old expiry after a live renewal', async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-01-01T00:00:00Z'); vi.setSystemTime(start);
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ subscription: { shop_id: 'shop', term: 'monthly', started_at: '2025-12-01T00:00:00Z', expires_at: new Date(start.getTime() + 86_400_000).toISOString(), is_permanent: false }, warning_days: 7 }) })));
      render(<SubscriptionNotice subscription={{ shop_id: 'shop', term: 'monthly', started_at: '2025-12-01T00:00:00Z', expires_at: new Date(start.getTime() + 120_000).toISOString(), is_permanent: false }} warningDays={7} isOwner={false} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(120_100); });
      expect(router.replace).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('keeps the expired recovery workspace accessible', () => {
    render(<SubscriptionNotice subscription={null} warningDays={7} isOwner lockOnExpire={false} />);
    expect(router.replace).not.toHaveBeenCalled();
  });
  it('never warns for permanent access', () => {
    render(<SubscriptionNotice subscription={{ shop_id: 'shop', term: null, started_at: null, expires_at: null, is_permanent: true }} warningDays={7} isOwner />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
