import 'server-only';
import { createAdminSupabase } from '@/lib/supabase';

export type PublicPricing = { monthly_paise: number | null; six_months_paise: number | null; yearly_paise: number | null };

/** Only price fields are public; never return the recipient or admin metadata. */
export async function getPublicPricing(): Promise<PublicPricing | null> {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const { data, error } = await createAdminSupabase().from('subscription_plan')
      .select('monthly_paise, six_months_paise, yearly_paise').eq('id', true).maybeSingle();
    if (error || !data) return null;
    const safe = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000 ? value : null;
    return { monthly_paise: safe(data.monthly_paise), six_months_paise: safe(data.six_months_paise), yearly_paise: safe(data.yearly_paise) };
  } catch {
    return null;
  }
}
