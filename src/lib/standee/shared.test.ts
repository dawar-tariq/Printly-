import { describe, expect, it } from 'vitest';
import { isStandeeTheme, standeeOrderUrl } from './shared';

describe('standee shop links and approved styles', () => {
  it('uses the configured origin and immutable code-based order path', () => {
    expect(standeeOrderUrl('https://printly.example/', 'AB1234', true)).toBe('https://printly.example/s/p-ab1234/order');
    expect(standeeOrderUrl('https://printly.example', 'CD5678', true)).toBe('https://printly.example/s/p-cd5678/order');
    expect(standeeOrderUrl('http://localhost:3000', 'DEMO1', false)).toBe('http://localhost:3000/s/p-demo1/order');
  });
  it('fails closed on invalid site URLs and codes rather than trusting request hosts', () => {
    for (const site of [undefined, 'http://example.com', 'https://example.com/path', 'https://example.com/?bad=1', 'https://user:pass@example.com', 'javascript:alert(1)']) {
      expect(() => standeeOrderUrl(site, 'AB1234', true)).toThrow();
    }
    for (const code of ['', 'abc', '../../bad', 'valid-code', 'x'.repeat(17)]) {
      expect(() => standeeOrderUrl('https://printly.example', code, true)).toThrow();
    }
  });
  it('accepts only the fixed brand colours', () => {
    expect(isStandeeTheme('orange')).toBe(true);
    expect(isStandeeTheme('deep')).toBe(true);
    for (const value of ['black', '#fff', '__proto__', 'constructor']) expect(isStandeeTheme(value)).toBe(false);
  });
});
