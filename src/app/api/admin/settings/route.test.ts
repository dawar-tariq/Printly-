import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'admin', error: null as null | { message: string },
  writes: [] as Array<Array<{ key: string; value: number | boolean }>>,
}));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  getSessionProfile: async () => ({ profile: { role: state.role } }),
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: () => ({
    select: () => ({ in: async () => ({ data: [], error: state.error }) }),
    upsert: async (rows: Array<{ key: string; value: number | boolean }>) => { state.writes.push(rows); return { error: state.error }; },
  }),
}) }));
import { GET, PUT } from './route';
const request = (body: unknown) => new Request('https://printly.test/api/admin/settings', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => { state.role = 'admin'; state.error = null; state.writes = []; });
describe('admin platform settings', () => {
  it('rejects other roles and invalid values', async () => {
    state.role = 'shop_staff';
    expect((await GET()).status).toBe(403);
    expect((await PUT(request({ gst_bps: 1800 }))).status).toBe(403);
    state.role = 'admin';
    expect((await PUT(request({ gst_bps: 9000 }))).status).toBe(422);
    expect(state.writes).toHaveLength(0);
  });
  it('saves all values in one operation as JSON numbers and booleans', async () => {
    expect((await PUT(request({ gst_bps: 1800, rush_bps: 1000, maintenance: false }))).status).toBe(200);
    expect(state.writes).toEqual([[{ key: 'gst_bps', value: 1800 }, { key: 'rush_bps', value: 1000 }, { key: 'maintenance', value: false }]]);
  });
  it('returns an error when reading or saving fails', async () => {
    state.error = { message: 'database unavailable' };
    expect((await GET()).status).toBe(503);
    expect((await PUT(request({ gst_bps: 1800 }))).status).toBe(503);
  });
});
