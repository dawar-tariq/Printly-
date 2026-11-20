import { describe, it, expect } from 'vitest';
import { shopSignupInput } from './contracts';
import { onboardingChecklist, onboardingCompleteness, formatBusinessHours } from './onboarding';

const base = {
  shop_name: 'Bright Prints',
  owner_name: 'Asha Khan',
  email: 'asha@example.com',
  password: 'password123',
  phone: '9906000000',
  address: 'Shop 4, Lal Chowk',
  city: 'Srinagar',
};

describe('shopSignupInput', () => {
  it('accepts the legacy minimal payload (backwards compatible)', () => {
    expect(shopSignupInput.safeParse(base).success).toBe(true);
  });

  it('accepts a full onboarding payload with services + inventory', () => {
    const r = shopSignupInput.safeParse({
      ...base,
      business_type: 'digital_printing',
      pincode: '190001',
      upi_id: 'asha@okaxis',
      services: ['print', 'photocopy'],
      inventory: [{ name: 'A4 paper', category: 'paper', qty: 5000, unit: 'sheets', low_stock_threshold: 1000 }],
      business_hours: { open_time: '09:00', close_time: '21:00', weekly_off: 'Sunday' },
      printer_count: 2,
      staff_count: 3,
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid service / category values', () => {
    expect(shopSignupInput.safeParse({ ...base, services: ['teleport'] }).success).toBe(false);
    expect(shopSignupInput.safeParse({ ...base, inventory: [{ name: 'X', category: 'gold', qty: 1 }] }).success).toBe(false);
  });

  it('rejects empty services array and bad email', () => {
    expect(shopSignupInput.safeParse({ ...base, services: [] }).success).toBe(false);
    expect(shopSignupInput.safeParse({ ...base, email: 'nope' }).success).toBe(false);
  });
});

describe('onboarding checklist', () => {
  const fullShop = { name: 'Bright Prints', address: 'Shop 4', city: 'Srinagar', phone: '9906000000', upi_id: 'a@okaxis', gstin: null };
  const fullOb = {
    business_type: 'digital_printing', pincode: '190001', printer_count: 2, printer_details: 'HP M404',
    business_hours: { open_time: '09:00', close_time: '21:00' }, registration_type: 'unregistered',
  };

  it('marks a complete application as 100%', () => {
    expect(onboardingCompleteness(fullShop, fullOb, { inventoryCount: 3, enabledServices: 4 })).toBe(100);
  });

  it('flags missing items for a sparse application', () => {
    const items = onboardingChecklist({ name: 'X' }, null, { inventoryCount: 0, enabledServices: 0 });
    const missing = items.filter((i) => !i.done).map((i) => i.key);
    expect(missing).toContain('upi');
    expect(missing).toContain('inventory');
    expect(missing).toContain('services');
    expect(onboardingCompleteness({ name: 'X' }, null, {})).toBeLessThan(50);
  });

  it('requires a registration number when a registration type is chosen', () => {
    const items = onboardingChecklist(fullShop, { ...fullOb, registration_type: 'gstin', registration_number: '' }, { inventoryCount: 1, enabledServices: 1 });
    expect(items.find((i) => i.key === 'registration')?.done).toBe(false);
  });

  it('formats business hours readably', () => {
    expect(formatBusinessHours({ open_time: '09:00', close_time: '21:00', weekly_off: 'Sunday' })).toBe('09:00 – 21:00 · Weekly off: Sunday');
    expect(formatBusinessHours(null)).toBe('—');
    expect(formatBusinessHours({})).toBe('—');
  });
});
