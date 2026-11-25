/** Shops operate on India time; do not let a server's timezone change today's count. */
export function startOfIndiaDay(now = new Date()): string {
  const offset = 330 * 60_000;
  const india = new Date(now.getTime() + offset);
  return new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate()) - offset).toISOString();
}

/** PostgREST's `or` filter has syntax characters: do not insert user syntax into it. */
export function boardSearch(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.slice(0, 120).replace(/[^\p{L}\p{M}\p{N} +\-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Exact UUID only: never insert arbitrary text into a PostgREST ID filter. */
export function boardOrderId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
