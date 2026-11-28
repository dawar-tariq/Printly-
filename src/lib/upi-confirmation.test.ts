// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { requestUpiDecision } from './upi-confirmation';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not confirm when independent verification is not acknowledged', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(await requestUpiDecision('order', 'confirm', 'ref')).toBe('cancelled');
  expect(fetcher).not.toHaveBeenCalled();
});
it('warns about duplicates and sends an override only after separate consent', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(true);
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'possible_duplicate' }, duplicate_count: 1, duplicates: [{ id: 'other', token: 'A-002', payment_status: 'confirmed' }] }, { status: 409 })).mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  expect(await requestUpiDecision('order', 'confirm', 'ref-123')).toBe('updated');
  expect(confirm.mock.calls[0][0]).toMatch(/not proof/i);
  expect(confirm.mock.calls[1][0]).toMatch(/possible duplicate.*A-002/is);
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toMatchObject({ verification_confirmed: true, duplicate_acknowledged: false });
  expect(JSON.parse(String(fetcher.mock.calls[1][1].body))).toMatchObject({ verification_confirmed: true, duplicate_acknowledged: true });
});
it('does not override a duplicate when the operator cancels and explains an absent reference', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: 'possible_duplicate' }, duplicate_count: 1 }, { status: 409 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await requestUpiDecision('order', 'confirm', null)).toBe('cancelled');
  expect(confirm.mock.calls[0][0]).toMatch(/cannot be checked automatically/i);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
