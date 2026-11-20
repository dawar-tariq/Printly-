// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { channel: () => channel, removeChannel: () => {} };
} }));
import ShopBoardPage from './page';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); mocks.push.mockClear(); });

describe('shop payment recovery', () => {
  it('keeps pending payments unconfirmed and looks up only a valid order ID from the tracking link', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json({ orders: url.includes('lane=confirm') ? [{
      id, token: null, status: 'draft', payment_status: 'pending', payment_method: 'upi', customer_name: 'A', customer_phone: '9797000000',
      total_paise: 472, rush: false, eta_minutes: 20, utr: null, created_at: '2026-11-19T12:00:00Z', items: [{ count: 1 }],
    }] : [] })));
    render(<ShopBoardPage />);
    const confirm = await screen.findByRole('button', { name: 'Payment received' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByText('Find an order with its tracking link'));
    const input = screen.getByLabelText('Tracking link or order ID');
    fireEvent.change(input, { target: { value: 'not-an-order' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find order' }));
    expect(screen.getByRole('alert').textContent).toContain('full tracking link');
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: `https://printly.example/track/${id}/?shared=1` } });
    fireEvent.click(screen.getByRole('button', { name: 'Find order' }));
    expect(mocks.push).toHaveBeenCalledWith(`/shop/orders/${id}`);
  });
});
