// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import SupportPage from './page';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

describe('private customer support', () => {
  it('shows a saveable code even after a lost response and retries the same request without persisting it', async () => {
    const attempts: Record<string, string>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (url === '/api/support') {
        attempts.push(body);
        if (attempts.length === 1) throw new Error('connection lost');
        return Response.json({ ok: true });
      }
      return Response.json({ ticket: { id: body.id, subject: 'Printer issue', status: 'open', message_count: 1 }, messages: [{ id: 'm', sender: 'customer', body: 'Please help.', created_at: '2026-01-01T00:00:00Z' }] });
    }));
    render(<SupportPage />);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Printer issue' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please help.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const code = await screen.findByLabelText('Your private access code') as HTMLTextAreaElement;
    expect(code.value).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    await screen.findByText(/keep your code and retry/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry sending request' }));
    expect(await screen.findByText('Please help.')).toBeTruthy();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(code.value).toBe(`${attempts[0].id}.${attempts[0].secret}`);
    expect(JSON.stringify(localStorage)).not.toContain(attempts[0].secret);
  });

  it('opens a saved code, sends a reply and never puts the credential in a URL', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const secret = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
    const bodies: Array<{ url: string; body: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push({ url, body });
      return body.action === 'read' ? Response.json({ ticket: { id, subject: 'Help', status: 'answered', message_count: 2 }, messages: [{ id: 'm', sender: 'admin', body: 'Please check again.', created_at: '2026-01-01T00:00:00Z' }] }) : Response.json({ ok: true });
    }));
    render(<SupportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open a request' }));
    fireEvent.change(screen.getByLabelText('Private access code'), { target: { value: `${id}.${secret}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(await screen.findByText('Please check again.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Thanks!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(bodies.some(({ body }) => body.action === 'reply' && body.message === 'Thanks!')).toBe(true));
    expect(bodies.every(({ url }) => !url.includes(id) && !url.includes(secret))).toBe(true);
  });

  it('offers Hindi and right-to-left Urdu guidance without storing the support code', async () => {
    render(<SupportPage />);
    fireEvent.change(screen.getByLabelText('Language / भाषा / زبان'), { target: { value: 'hi' } });
    expect(screen.getByText('Printly सहायता')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Language / भाषा / زبان'), { target: { value: 'ur' } });
    expect(screen.getByText('Printly مدد')).toBeTruthy();
    expect(screen.getByText('Printly مدد').closest('[dir]')?.getAttribute('dir')).toBe('rtl');
    expect(localStorage.getItem('printly-customer-language')).toBe('ur');
  });
});
