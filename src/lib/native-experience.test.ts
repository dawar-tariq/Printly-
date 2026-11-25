import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeExperience } from './native-experience';
import { GET } from '@/app/api/native/v1/experience/route';

afterEach(() => vi.unstubAllEnvs());

describe('native presentation settings', () => {
  it('publishes only bounded plain-text presentation and timing fields', () => {
    const result = nativeExperience({
      PRINTLY_NATIVE_NOTICE: '  Orders\nare moving  ', PRINTLY_NATIVE_HOME_SUBTITLE: 'Welcome to your shop',
      PRINTLY_NATIVE_BOARD_REFRESH_SECONDS: '20', SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-returned',
    });
    expect(result).toEqual({ schema: 1, notice: 'Orders are moving', home_subtitle: 'Welcome to your shop', board_refresh_seconds: 20 });
    expect(JSON.stringify(result)).not.toContain('must-not-be-returned');
  });
  it('uses safe defaults for oversized text and unsafe intervals', () => {
    for (const value of ['0', '9', '61', '-1', '1e1', '10.0', 'NaN', '300', '']) {
      expect(nativeExperience({ PRINTLY_NATIVE_NOTICE: 'x'.repeat(181), PRINTLY_NATIVE_HOME_SUBTITLE: 'x'.repeat(121), PRINTLY_NATIVE_BOARD_REFRESH_SECONDS: value }))
        .toEqual({ schema: 1, notice: '', home_subtitle: '', board_refresh_seconds: 15 });
    }
    expect(nativeExperience({ PRINTLY_NATIVE_BOARD_REFRESH_SECONDS: '10' }).board_refresh_seconds).toBe(10);
    expect(nativeExperience({ PRINTLY_NATIVE_BOARD_REFRESH_SECONDS: '60' }).board_refresh_seconds).toBe(60);
  });
  it('serves fresh, non-sensitive settings to an installed app', async () => {
    vi.stubEnv('PRINTLY_NATIVE_NOTICE', 'New counter hours');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ schema: 1, notice: 'New counter hours' });
  });
});
