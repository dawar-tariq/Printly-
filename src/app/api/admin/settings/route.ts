import { readJsonBody } from '@/lib/request-body';
import { z } from 'zod';
import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

const SETTING_KEYS = ['gst_bps', 'rush_bps', 'maintenance'] as const;

export async function GET() {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const admin = createAdminSupabase();
  const { data, error } = await admin.from('platform_settings').select('key, value').in('key', [...SETTING_KEYS]);
  if (error) return jsonError(503, 'db', 'Could not load settings. Please retry.');
  return jsonOk({ settings: Object.fromEntries((data ?? []).map((s) => [s.key, s.value])) });
}

const putInput = z.object({
  gst_bps: z.number().int().min(0).max(5000).optional(),
  rush_bps: z.number().int().min(0).max(5000).optional(),
  maintenance: z.boolean().optional(),
}).strict();

export async function PUT(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const parsed = putInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid settings');
  const rows = Object.entries(parsed.data)
    .filter((entry): entry is [string, number | boolean] => entry[1] !== undefined)
    .map(([key, value]) => ({ key, value, updated_by: session.user.id }));
  if (!rows.length) return jsonOk({ ok: true });
  const admin = createAdminSupabase();
  // One statement makes the settings update atomic. Values are JSON numbers or
  // booleans, not strings containing their serialized representations.
  const { error } = await admin.from('platform_settings').upsert(rows);
  if (error) {
    console.error('Could not save platform settings:', error.message);
    return jsonError(503, 'db', 'Could not save settings. Please retry.');
  }
  return jsonOk({ ok: true });
}
