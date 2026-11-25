// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_CONTACT_KEY } from './remembered-customer-contact';
import { useRememberedCustomerContact } from './use-remembered-customer-contact';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('remembered-contact controls', () => {
  it('defaults off, saves only after opt-in, restores on another visit and lets the customer edit or clear', async () => {
    const first = renderHook(() => useRememberedCustomerContact());
    act(() => { first.result.current.setName('Aisha Khan'); first.result.current.setPhone('9797000000'); first.result.current.setEmail('aisha@example.com'); });
    expect(first.result.current.remember).toBe(false);
    expect(localStorage.getItem(CUSTOMER_CONTACT_KEY)).toBeNull();
    act(() => first.result.current.choose(true));
    await waitFor(() => expect(first.result.current.status).toBe('saved'));
    first.unmount();

    const again = renderHook(() => useRememberedCustomerContact());
    await waitFor(() => expect(again.result.current.name).toBe('Aisha Khan'));
    expect(again.result.current.phone).toBe('9797000000');
    expect(again.result.current.email).toBe('aisha@example.com');
    expect(again.result.current.remember).toBe(true);
    act(() => { again.result.current.setPhone('9876500000'); again.result.current.setEmail(''); });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(CUSTOMER_CONTACT_KEY)!).phone).toBe('9876500000'));
    expect(JSON.parse(localStorage.getItem(CUSTOMER_CONTACT_KEY)!).email).toBe('');
    act(() => again.result.current.clear());
    expect(localStorage.getItem(CUSTOMER_CONTACT_KEY)).toBeNull();
    expect(again.result.current.remember).toBe(false);
    expect(again.result.current.phone).toBe('9876500000'); // existing order is unchanged
  });

  it('does not silently re-save after another tab clears the record', async () => {
    const view = renderHook(() => useRememberedCustomerContact());
    act(() => { view.result.current.setName('Aisha'); view.result.current.setPhone('9797000000'); view.result.current.choose(true); });
    await waitFor(() => expect(view.result.current.status).toBe('saved'));
    act(() => {
      view.result.current.setName('Edited');
      localStorage.removeItem(CUSTOMER_CONTACT_KEY);
      window.dispatchEvent(new StorageEvent('storage', { key: CUSTOMER_CONTACT_KEY, newValue: null }));
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(localStorage.getItem(CUSTOMER_CONTACT_KEY)).toBeNull();
    expect(view.result.current.remember).toBe(false);
    expect(view.result.current.status).toBe('changed');
  });

  it('reports storage failure without preventing use of the current fields', async () => {
    const view = renderHook(() => useRememberedCustomerContact());
    act(() => { view.result.current.setName('Aisha'); view.result.current.setPhone('9797000000'); });
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    act(() => view.result.current.choose(true));
    await waitFor(() => expect(view.result.current.status).toBe('unavailable'));
    expect(view.result.current.name).toBe('Aisha');
    act(() => view.result.current.clear());
    expect(view.result.current.status).toBe('removeFailed');
  });
});
