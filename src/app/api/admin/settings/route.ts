import { z } from 'zod';
import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

const SETTING_KEYS = ['commission_bps', 'gst_bps', 'rush_bps', 'maintenance'] as const;

export async function GET() {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const admin = createAdminSupabase();
  const { data } = await admin.from('platform_settings').select('key, value').in('key', [...SETTING_KEYS]);
  return jsonOk({ settings: Object.fromEntries((data ?? []).map((s) => [s.key, s.value])) });
}

const putInput = z.object({
  commission_bps: z.number().int().min(0).max(5000).optional(),
  gst_bps: z.number().int().min(0).max(5000).optional(),
  rush_bps: z.number().int().min(0).max(5000).optional(),
  maintenance: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const parsed = putInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid settings');
  const admin = createAdminSupabase();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    await admin.from('platform_settings').upsert({ key, value: JSON.stringify(value) });
  }
  return jsonOk({ ok: true });
}
