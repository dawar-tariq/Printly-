import { describe, expect, it } from 'vitest';
import { passwordPolicyError } from './password-policy';
import { shopSignupInput } from './contracts';

const application = { shop_name: 'Print shop', owner_name: 'Owner Name', email: 'owner@example.test',
  phone: '1234567890', address: '123 Street', city: 'Srinagar' };

describe('password policy for new passwords', () => {
  it('requires 12 characters and permits up to 72 UTF-8 bytes', () => {
    expect(passwordPolicyError('short')).toMatch(/12 characters/);
    expect(passwordPolicyError('a'.repeat(72))).toBeNull();
    expect(passwordPolicyError('a'.repeat(73))).toMatch(/72 UTF-8 bytes/);
    expect(passwordPolicyError('😀'.repeat(12))).toBeNull();
    expect(passwordPolicyError('😀'.repeat(19))).toMatch(/72 UTF-8 bytes/);
    expect(passwordPolicyError('😀'.repeat(6))).toMatch(/12 characters/);
  });
  it('enforces the same rules on the server-side signup schema', () => {
    expect(shopSignupInput.safeParse({ ...application, password: 'short123' }).success).toBe(false);
    expect(shopSignupInput.safeParse({ ...application, password: '😀'.repeat(19) }).success).toBe(false);
    expect(shopSignupInput.safeParse({ ...application, password: 'a-long-unique-password' }).success).toBe(true);
  });
});
