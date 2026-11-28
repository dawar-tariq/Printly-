import { getSessionProfile, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { PROOF_BUCKET } from '@/lib/name-proof';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const { id } = await params;
  const admin = createAdminSupabase();
  const { data: proof, error } = await admin.from('shop_onboarding').select('name_proof_photo_path').eq('shop_id', id).maybeSingle();
  if (error) return jsonError(500, 'db', 'Could not retrieve the proof.');
  if (!proof?.name_proof_photo_path) return jsonError(404, 'not_found', 'No shop photo was submitted.');
  const { data: photo, error: downloadError } = await admin.storage.from(PROOF_BUCKET).download(proof.name_proof_photo_path);
  if (downloadError || !photo) return jsonError(404, 'not_found', 'Shop photo is unavailable.');
  const ext = proof.name_proof_photo_path.split('.').pop();
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return new Response(new Uint8Array(await photo.arrayBuffer()), { headers: {
    'Content-Type': contentType, 'Content-Disposition': `inline; filename="shop-photo.${ext === 'png' || ext === 'webp' ? ext : 'jpg'}"`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
  } });
}
