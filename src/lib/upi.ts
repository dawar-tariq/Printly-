/** UPI collect helpers — the shop owner's own UPI ID receives funds directly; no gateway fees. */
export interface UpiIntent {
  link: string; // upi://pay?...
  pa: string;
  pn: string;
  am: string; // rupees with 2 decimals
  tn: string;
}

export function buildUpiIntent(opts: { upiId: string; payeeName: string; amountPaise: number; note: string }): UpiIntent {
  const am = (opts.amountPaise / 100).toFixed(2);
  const tn = opts.note.slice(0, 60);
  const params = new URLSearchParams({
    pa: opts.upiId.trim(),
    pn: opts.payeeName.trim().slice(0, 50),
    am,
    cu: 'INR',
    tn,
  });
  // URLSearchParams encodes spaces as '+', UPI apps prefer %20
  const link = 'upi://pay?' + params.toString().replace(/\+/g, '%20');
  return { link, pa: opts.upiId.trim(), pn: opts.payeeName.trim(), am, tn };
}

export function isValidUpiId(v: string): boolean {
  return /^[\w.\-]{2,}@[a-zA-Z][\w.\-]{1,}$/.test(v.trim());
}
