// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'order-1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import { ShopOrderDetail } from './ShopOrderDetail';

const detail = {
  order: { id: 'order-1', token: 'A-001', status: 'queued', payment_status: 'cod_pending', payment_method: 'cod', customer_name: 'Customer', customer_phone: '9999999999', customer_email: '', notes: '', subtotal_paise: 1800, tax_paise: 324, total_paise: 2124, rush: false, eta_minutes: 20, utr: null, created_at: '2026-11-01T00:00:00Z', shops: { id: 'shop', name: 'Shop', slug: 'p-demo1' } },
  items: [{ id: 'item', file_id: 'file', service: 'print', paper_size: 'A4', color: 'bw', sides: 'duplex', paper_gsm: 80, option: null, copies: 2, pages: 5, unit_price_paise: 300, line_total_paise: 1800 }],
  files: [{ id: 'file', original_name: 'file.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: 1024, page_count: null, source: 'upload' }],
  events: [], payment: null,
};

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => Response.json(detail))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shop order duplex details', () => {
  it('shows physical-sheet instructions and warns about unverified Word counts without changing the stored amount', async () => {
    render(<ShopOrderDetail />);
    expect(await screen.findByText('6 sheets needed')).toBeTruthy();
    expect(screen.getByText(/Double-sided instructions/i).parentElement?.textContent).toMatch(/pages 1\/2, 3\/4.*odd last page/i);
    expect(screen.getByText(/Word preview is unavailable/i)).toBeTruthy();
    expect(screen.getAllByText('file.docx')).toHaveLength(2); // file list and linked print line
    expect(screen.getAllByText('₹21.24').length).toBeGreaterThan(0);
    expect(screen.getByText(/not necessarily the billing unit/i)).toBeTruthy();
  });

  it('does not label single-sided items as duplex', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...detail, items: [{ ...detail.items[0], sides: 'single' }] })));
    render(<ShopOrderDetail />);
    await screen.findByText('Print spec');
    expect(screen.queryByText(/sheets needed/i)).toBeNull();
    expect(screen.queryByText(/Double-sided instructions/i)).toBeNull();
  });
});
