// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrderReference } from './OrderReference';

const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => { cleanup(); Reflect.deleteProperty(navigator, 'clipboard'); vi.restoreAllMocks(); });

describe('order reference', () => {
  it('shows the complete ID, explains its privacy, and copies only that ID', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<OrderReference id={id} />);
    expect(screen.getByText(id)).toBeTruthy();
    expect(screen.getByText(/anyone with this ID can view tracking/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy order ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(id));
    expect(await screen.findByText('Copied')).toBeTruthy();
  });
  it('keeps the ID selectable and explains when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<OrderReference id={id} language="hi" />);
    fireEvent.click(screen.getByRole('button', { name: 'ऑर्डर ID कॉपी करें' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText(id).className).toContain('select-all');
  });
});
