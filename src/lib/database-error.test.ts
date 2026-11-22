import { describe, expect, it } from 'vitest';
import { isDefiniteDatabaseRejection } from './database-error';

describe('database write outcomes', () => {
  it('recognizes returned constraint and explicit transaction errors', () => {
    for (const code of ['23505', '23514', '22001', '42501', 'P0001']) {
      expect(isDefiniteDatabaseRejection({ code })).toBe(true);
    }
  });
  it('does not confuse a network, gateway, or uncertain completion with rollback', () => {
    for (const error of [null, {}, new Error('fetch failed'), { code: 'PGRST003' }, { code: '08006' }, { code: '40003' }, { code: '' }]) {
      expect(isDefiniteDatabaseRejection(error)).toBe(false);
    }
  });
});
