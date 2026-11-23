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
