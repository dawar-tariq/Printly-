import { createServerSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createServerSupabase();
  const { data: shop, error } = await supabase
    .from('shops')
    .select('id, slug, name, address, city, phone, upi_id, kyc_status, status, eta_minutes, rating_avg, rating_count, gstin')
    .eq('slug', slug)
    .maybeSingle();
  if (error) return jsonError(500, 'db', error.message);
  if (!shop) return jsonError(404, 'not_found', 'Shop not found');

  const [{ data: services }, { data: rates }] = await Promise.all([
    supabase.from('shop_services').select('service, enabled, display_order').eq('shop_id', shop.id).order('display_order'),
    supabase.from('rate_card').select('service, paper_size, color, sides, paper_gsm, option, unit, price_paise').eq('shop_id', shop.id),
  ]);
  return jsonOk({ shop, services: services ?? [], rateCard: rates ?? [] });
}
