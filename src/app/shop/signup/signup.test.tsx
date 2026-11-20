// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import ShopSignupPage from './page';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fillRequired() {
  fireEvent.change(screen.getByPlaceholderText('Owner / manager name'), { target: { value: 'Asha Khan' } });
  fireEvent.change(screen.getByPlaceholderText('shop@example.com'), { target: { value: 'asha@example.com' } });
  fireEvent.change(document.querySelector('input[type=password]')!, { target: { value: 'password123' } });
  fireEvent.change(screen.getByPlaceholderText('99060 00000'), { target: { value: '9906000000' } });
  fireEvent.change(screen.getByPlaceholderText('Shop number, street, landmark'), { target: { value: 'Shop 4 Lal Chowk' } });
  fireEvent.change(screen.getByPlaceholderText('Srinagar'), { target: { value: 'Srinagar' } });
}

describe('name proof in onboarding', () => {
  it('does not ask for a photo or GSTIN when the name is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ duplicate: false })));
    render(<ShopSignupPage />);
    fireEvent.change(screen.getByLabelText('Shop name *'), { target: { value: 'Bright Prints' } });
    fillRequired();
    await screen.findByText('This name is available. No name proof is required.');
    expect(screen.queryByLabelText(/Shop photo/)).toBeNull();
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('requires photo or GSTIN when the name matches an existing shop', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ duplicate: true })));
    render(<ShopSignupPage />);
    fireEvent.change(screen.getByLabelText('Shop name *'), { target: { value: 'Bright Prints' } });
    fillRequired();
    await screen.findByText('Another shop already uses this name');
    expect(screen.getByLabelText(/Shop photo/)).toBeTruthy();
    const next = screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('01ABCDE1234F1Z5'), { target: { value: 'invalid' } });
    expect(next.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('01ABCDE1234F1Z5'), { target: { value: '01ABCDE1234F1Z5' } });
    expect(next.disabled).toBe(false);
  });
});
