import { getStaffContext, jsonError, jsonOk } from '@/lib/api';
import { readJsonBody } from '@/lib/request-body';
import { boardOrderId, boardSearch, startOfIndiaDay } from '@/lib/shop-board';

const PAGE_SIZE = 30;
const LANES = ['confirm', 'queued', 'printing', 'ready'] as const;
type Lane = (typeof LANES)[number];

function pageNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(parsed, 100_000)) : 1;
}

/** One authenticated refresh for the whole board. Search is in the body, not URL logs. */
export async function POST(req: Request) {
  const staff = await getStaffContext();
  if (!staff) return jsonError(401, 'unauthorized', 'Sign in required');
  if (staff.isAdmin || !staff.shopIds.length) return jsonError(403, 'no_shop', 'No active shop linked to this account');
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError(422, 'validation', 'Invalid board request');
  const input = body as { pages?: Record<string, unknown>; search?: unknown; shop_id?: unknown };
  const shopId = typeof input.shop_id === 'string' ? input.shop_id : staff.shopIds[0];
  if (!staff.shopIds.includes(shopId)) return jsonError(403, 'forbidden', 'Not your shop');
  const orderId = boardOrderId(input.search);
  const search = orderId ? '' : boardSearch(input.search);
  const pages = input.pages && typeof input.pages === 'object' ? input.pages : {};
  const admin = staff.admin;

  const readLane = async (lane: Lane) => {
    const page = pageNumber(pages[lane]);
    let query = admin.from('orders')
      .select('id, token, status, payment_status, payment_method, customer_name, customer_phone, total_paise, rush, eta_minutes, utr, created_at, items:order_items(count)', { count: 'exact' })
      .eq('shop_id', shopId);
    if (lane === 'confirm') query = query.eq('status', 'draft').eq('payment_method', 'upi').in('payment_status', ['submitted', 'pending']);
    else query = query.eq('status', lane);
    if (orderId) {
      // A UUID remains scoped to the verified shop, including in the native API.
      query = query.eq('id', orderId);
    } else if (search) {
      // `search` cannot contain PostgREST punctuation or SQL wildcard syntax.
      query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,token.ilike.%${search}%,utr.ilike.%${search}%`);
    }
    const result = await query.order('created_at', { ascending: true }).order('id', { ascending: true })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (result.error || result.count === null) throw new Error('lane unavailable');
    return { orders: result.data ?? [], pagination: { page, pages: Math.max(1, Math.ceil(result.count / PAGE_SIZE)), count: result.count } };
  };

  try {
    const [confirm, queued, printing, ready, completed, attention] = await Promise.all([
      readLane('confirm'), readLane('queued'), readLane('printing'), readLane('ready'),
      admin.from('orders').select('id', { count: 'exact', head: true }).eq('shop_id', shopId)
        .eq('status', 'collected').gte('collected_at', startOfIndiaDay()),
      // Bounded, independent of the current page/search. A missed realtime event
      // can still surface on the next poll; audio is advisory, not delivery proof.
      admin.from('orders').select('id, updated_at').eq('shop_id', shopId)
        .or('status.eq.queued,and(status.eq.draft,payment_method.eq.upi,payment_status.eq.submitted)')
        .order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(50),
    ]);
    if (completed.error || completed.count === null || attention.error) throw new Error('board unavailable');
    return jsonOk({ shop_id: shopId, lanes: { confirm, queued, printing, ready }, completed_today: completed.count, attention: attention.data ?? [] },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return jsonError(503, 'db', 'Could not load orders. Please try again.');
  }
}
