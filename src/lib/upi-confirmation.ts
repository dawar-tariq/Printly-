'use client';

/** Reports and reference matches are not proof of a transfer. */
export async function requestUpiDecision(id: string, action: 'confirm' | 'reject', reference?: string | null): Promise<'updated' | 'cancelled'> {
  const prompt = action === 'confirm'
    ? `Have you independently checked the receiving account, amount and transaction reference? A customer report is not proof of payment.${reference?.trim() ? '' : '\n\nNo reference is available, so matching references cannot be checked automatically. Check for a duplicate payment manually.'}`
    : 'Mark this payment as not received? The customer may report it again.';
  if (!window.confirm(prompt)) return 'cancelled';
  const send = (duplicateAcknowledged: boolean) => fetch(`/api/shop/orders/${id}/confirm-payment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, utr: reference?.trim() || undefined,
      verification_confirmed: action === 'confirm', duplicate_acknowledged: duplicateAcknowledged }),
  });
  let response = await send(false);
  let body = await response.json().catch(() => ({}));
  if (action === 'confirm' && response.status === 409 && body?.error?.code === 'possible_duplicate') {
    const count = Number.isSafeInteger(body.duplicate_count) ? body.duplicate_count : 1;
    const matches = Array.isArray(body.duplicates) ? body.duplicates.slice(0, 5).map((item: { id?: unknown; token?: unknown; payment_status?: unknown }) => {
      const label = typeof item.token === 'string' && /^[\w-]{1,40}$/.test(item.token) ? item.token : typeof item.id === 'string' ? item.id.slice(0, 8) : 'another order';
      const status = typeof item.payment_status === 'string' && /^[a-z_]{1,30}$/.test(item.payment_status) ? item.payment_status.replace(/_/g, ' ') : 'unknown';
      return `• ${label}: ${status}`;
    }).join('\n') : '';
    if (!window.confirm(`Possible duplicate: this reference appears on ${count} other order(s) in this shop.\n${matches}\n\nA match is not proof. Check your bank account and make sure this is a separate received transfer before continuing. Confirm anyway?`)) return 'cancelled';
    response = await send(true);
    body = await response.json().catch(() => ({}));
  }
  if (!response.ok) throw new Error(body?.error?.message ?? 'Could not update the payment. Please refresh and try again.');
  return 'updated';
}
