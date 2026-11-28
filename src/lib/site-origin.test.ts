import { describe, expect, it } from 'vitest';
import { siteOrigin } from './site-origin';

describe('canonical site origin', () => {
  it('accepts only an origin and requires HTTPS in production', () => {
    expect(siteOrigin('https://printly.example/', true)).toBe('https://printly.example');
    expect(siteOrigin('http://localhost:3000', false)).toBe('http://localhost:3000');
    expect(siteOrigin('http://printly.example', true)).toBeNull();
  });
  it.each([undefined, '', 'not a url', 'https://user:pass@printly.example', 'https://printly.example/path', 'https://printly.example/?secret=1', 'https://printly.example/#section', 'ftp://printly.example'])('rejects %s', (value) => {
    expect(siteOrigin(value, true)).toBeNull();
  });
});
