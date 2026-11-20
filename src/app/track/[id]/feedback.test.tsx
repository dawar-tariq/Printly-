// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const id = '11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation', () => ({ useParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import TrackPage from './page';

const track = {
  order_id: id, token: 'A1', status: 'collected', payment_status: 'confirmed', payment_method: 'upi',
  shop_name: 'Test shop', shop_slug: 'test', shop_city: '', total_paise: 1000, eta_minutes: 20,
  item_count: 1, rush: false, created_at: '2026-11-19T12:00:00Z', ready_at: null, collected_at: null,
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('feedback errors', () => {
  it('shows a rate-limit error and allows the rating to be retried', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/track')) return Response.json({ track });
      if (url.endsWith('/review')) return ++attempts === 1
        ? Response.json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait and try again.' } }, { status: 429 })
        : Response.json({ ok: true });
      throw new Error('Unexpected request');
    }));
    render(<TrackPage />);
    fireEvent.click(await screen.findByRole('button', { name: '5 stars' }));
    expect(screen.getByRole('button', { name: '5 stars' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/too many requests/i);
    expect(screen.queryByText('Thanks for the feedback!')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));
    expect(await screen.findByText('Thanks for the feedback!')).toBeTruthy();
  });
  it('does not treat an unrelated conflict as a successful rating', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/track')
      ? Response.json({ track })
      : Response.json({ error: { code: 'not_collected', message: 'You can rate once the order is collected' } }, { status: 409 })));
    render(<TrackPage />);
    fireEvent.click(await screen.findByRole('button', { name: '1 star' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/once the order is collected/i);
    expect(screen.queryByText('Thanks for the feedback!')).toBeNull();
  });
  it('shows an error when a report is rate-limited and does not claim it was received', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/track')
      ? Response.json({ track })
      : Response.json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait and try again.' } }, { status: 429 })));
    render(<TrackPage />);
    fireEvent.click(await screen.findByRole('button', { name: /something wrong with this order/i }));
    fireEvent.change(screen.getByLabelText('Describe the issue'), { target: { value: 'Pages are missing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/too many requests/i));
    expect(screen.queryByText(/report received/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeTruthy();
  });
});
