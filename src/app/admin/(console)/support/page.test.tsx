// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminSupportPage from './page';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const time = '2026-01-01T00:00:00Z';
const ticket = (id: string) => ({ id, subject: id === first ? 'First request' : 'Second request', status: 'open', message_count: 1, created_at: time, updated_at: time });
const inbox = () => Response.json({ tickets: [ticket(first), ticket(second)], pagination: { page: 1, pages: 1, count: 2 } });
const conversation = (id: string) => Response.json({ ticket: ticket(id), messages: [{ id, sender: 'customer', body: id === first ? 'Message from first customer' : 'Message from second customer', created_at: time }] });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('admin support selection races', () => {
  it('discards a late response from a previously selected conversation', async () => {
    let finishFirst: ((response: Response) => void) | undefined;
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/admin/support?')) return inbox();
      if (init?.method === 'POST') { sent.push(url); return Response.json({ ok: true }); }
      if (url.endsWith(first)) return new Promise<Response>((resolve) => { finishFirst = resolve; });
      if (url.endsWith(second)) return conversation(second);
      throw new Error(`Unexpected URL ${url}`);
    }));
    render(<AdminSupportPage />);
    fireEvent.click(await screen.findByRole('button', { name: /First request/ }));
    await waitFor(() => expect(finishFirst).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }));
    fireEvent.click(await screen.findByRole('button', { name: /Second request/ }));
    await screen.findByText('Message from second customer');
    await act(async () => { finishFirst!(conversation(first)); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.queryByText('Message from first customer')).toBeNull();
    expect(screen.getByText('Message from second customer')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Reply to the second customer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(sent).toEqual([`/api/admin/support/${second}`]));
  });

  it('does not let a late reply result alter a newly opened conversation', async () => {
    let finishFirstReply: ((response: Response) => void) | undefined;
    const posts: Array<{ url: string; body: { message: string } }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/admin/support?')) return inbox();
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return url.endsWith(first) ? new Promise<Response>((resolve) => { finishFirstReply = resolve; }) : Response.json({ ok: true });
      }
      if (url.endsWith(first)) return conversation(first);
      if (url.endsWith(second)) return conversation(second);
      throw new Error(`Unexpected URL ${url}`);
    }));
    render(<AdminSupportPage />);
    fireEvent.click(await screen.findByRole('button', { name: /First request/ }));
    await screen.findByText('Message from first customer');
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'First reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(finishFirstReply).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }));
    fireEvent.click(await screen.findByRole('button', { name: /Second request/ }));
    await screen.findByText('Message from second customer');
    const reply = screen.getByLabelText('Reply') as HTMLTextAreaElement;
    fireEvent.change(reply, { target: { value: 'Second reply' } });
    await act(async () => { finishFirstReply!(Response.json({ ok: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(reply.value).toBe('Second reply');
    expect(screen.queryByText(/Reply sent/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(posts.map(({ url, body }) => [url, body.message])).toEqual([
      [`/api/admin/support/${first}`, 'First reply'], [`/api/admin/support/${second}`, 'Second reply'],
    ]));
  });
});
