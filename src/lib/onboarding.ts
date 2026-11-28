/**
 * Shared labels + completeness logic for shop onboarding.
 * Used by the signup wizard, the admin shop list and the admin detail view
 * so "what's still needed" is computed the same way everywhere.
 */

export const SERVICE_LABELS: Record<string, string> = {
  print: 'Printing',
  photocopy: 'Photocopy / Xerox',
  scan: 'Scanning',
  bind: 'Binding',
  laminate: 'Lamination',
};

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  digital_printing: 'Digital printing',
  photocopy: 'Photocopy / Xerox',
  stationery: 'Stationery',
  internet_cafe: 'Internet café / CSC',
  other: 'Other',
};

export const REGISTRATION_LABELS: Record<string, string> = {
  unregistered: 'Not registered',
  gstin: 'GSTIN',
  udyam: 'Udyam (MSME)',
  shop_license: 'Shop & Establishment licence',
  other: 'Other registration',
};

export const INVENTORY_CATEGORY_LABELS: Record<string, string> = {
  paper: 'Paper',
  ink: 'Ink / Toner',
  binding: 'Binding',
  laminate: 'Lamination',
  other: 'Other',
};

export interface OnboardingLike {
  business_type?: string | null;
  legal_business_name?: string | null;
  year_established?: number | null;
  staff_count?: number | null;
  printer_count?: number | null;
  avg_daily_jobs?: number | null;
  printer_details?: string | null;
  pincode?: string | null;
  alternate_phone?: string | null;
  registration_type?: string | null;
  registration_number?: string | null;
  business_hours?: Record<string, unknown> | null;
  referral_source?: string | null;
}

export interface ShopLike {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  gstin?: string | null;
  upi_id?: string | null;
}

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  hint: string;
}

/** Human-readable checklist of what an application still needs. */
export function onboardingChecklist(
  shop: ShopLike,
  onboarding: OnboardingLike | null | undefined,
  opts: { inventoryCount?: number; enabledServices?: number } = {},
): ChecklistItem[] {
  const o = onboarding ?? {};
  const hours = (o.business_hours ?? {}) as Record<string, unknown>;
  const hasHours = Boolean(hours.open_time || hours.close_time);
  const regType = o.registration_type ?? 'unregistered';
  const needsRegNumber = regType !== 'unregistered';
  return [
    { key: 'shop_name', label: 'Shop name', done: Boolean(shop.name?.trim()), hint: 'Display name on the customer page' },
    { key: 'address', label: 'Shop address & city', done: Boolean(shop.address?.trim() && shop.city?.trim()), hint: 'Full address with landmark' },
    { key: 'pincode', label: 'PIN code', done: Boolean(o.pincode?.trim()), hint: 'Used for local discovery' },
    { key: 'phone', label: 'Contact phone', done: Boolean(shop.phone?.trim()), hint: 'For order calls / WhatsApp' },
    { key: 'upi', label: 'UPI ID for payments', done: Boolean(shop.upi_id?.trim()), hint: 'Customers pay directly to this ID' },
    { key: 'business_type', label: 'Business type', done: Boolean(o.business_type && o.business_type !== 'other'), hint: 'What the shop mainly does' },
    { key: 'services', label: 'Services offered', done: (opts.enabledServices ?? 0) >= 1, hint: 'At least one service enabled' },
    { key: 'equipment', label: 'Equipment details', done: (o.printer_count ?? 0) > 0 && Boolean(o.printer_details?.trim()), hint: 'Printer count + models' },
    { key: 'inventory', label: 'Starting inventory', done: (opts.inventoryCount ?? 0) >= 1, hint: 'Paper / ink / binding stock' },
    { key: 'hours', label: 'Business hours', done: hasHours, hint: 'Opening & closing time' },
    { key: 'registration', label: 'Registration details', done: !needsRegNumber || Boolean(o.registration_number?.trim() || shop.gstin?.trim()), hint: needsRegNumber ? 'Registration / GSTIN number' : 'Optional — unregistered shops can apply' },
  ];
}

export function onboardingCompleteness(
  shop: ShopLike,
  onboarding: OnboardingLike | null | undefined,
  opts: { inventoryCount?: number; enabledServices?: number } = {},
): number {
  const items = onboardingChecklist(shop, onboarding, opts);
  const done = items.filter((i) => i.done).length;
  return Math.round((done / items.length) * 100);
}

export function formatBusinessHours(hours: Record<string, unknown> | null | undefined): string {
  if (!hours) return '—';
  const open = typeof hours.open_time === 'string' ? hours.open_time : '';
  const close = typeof hours.close_time === 'string' ? hours.close_time : '';
  const off = typeof hours.weekly_off === 'string' ? hours.weekly_off : '';
  if (!open && !close && !off) return '—';
  const parts = [open && close ? `${open} – ${close}` : open || close];
  if (off) parts.push(`Weekly off: ${off}`);
  return parts.filter(Boolean).join(' · ');
}
