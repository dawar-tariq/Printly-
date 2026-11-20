import 'server-only';
import { NextResponse } from 'next/server';
import { MAINTENANCE_COPY, MAINTENANCE_PAYMENT_NOTE, type MaintenanceNotice } from '@/lib/maintenance';
import { printlyLogoGroup } from '@/lib/brand';

export type MaintenanceState = 'on' | 'off' | 'unknown';

/**
 * The settings table is not public. Read only the maintenance flag using the
 * server-only key, without caching, so a saved switch takes effect on the next
 * request. If the setting cannot be checked, fail closed rather than silently
 * accepting orders during a maintenance window.
 */
export async function readMaintenanceState(): Promise<MaintenanceState> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 'unknown';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const endpoint = new URL('/rest/v1/platform_settings', url);
    endpoint.searchParams.set('select', 'value');
    endpoint.searchParams.set('key', 'eq.maintenance');
    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return 'unknown';
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') return 'unknown';
    const value = (rows[0] as { value?: unknown }).value;
    // Older installations may have stored JSON strings rather than booleans.
    if (value === true || value === 'true') return 'on';
    if (value === false || value === 'false') return 'off';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timeout);
  }
}

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' };

export function maintenanceStatusResponse(state: MaintenanceState): NextResponse {
  if (state === 'off') return NextResponse.json({ maintenance: false }, { headers: noStoreHeaders });
  return maintenanceApiResponse(state);
}

export function maintenanceApiResponse(state: Exclude<MaintenanceState, 'off'>): NextResponse {
  const notice: MaintenanceNotice = state === 'on' ? 'maintenance' : 'unavailable';
  return NextResponse.json({
    error: {
      code: state === 'on' ? 'maintenance' : 'maintenance_status_unavailable',
      message: MAINTENANCE_COPY[notice].message,
    },
  }, {
    status: 503,
    headers: { ...noStoreHeaders, 'Retry-After': '60' },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Self-contained so the page is usable even with scripts and assets blocked. */
export function maintenancePageResponse(state: Exclude<MaintenanceState, 'off'>): NextResponse {
  const notice: MaintenanceNotice = state === 'on' ? 'maintenance' : 'unavailable';
  const copy = MAINTENANCE_COPY[notice];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#c2410c"><title>${escapeHtml(copy.title)} — Printly</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;background:#fbfaf8;color:#1c1917;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:620px;margin:auto;padding:40px 20px;text-align:center}.brand{display:inline-flex;align-items:center;gap:9px;font-size:19px;font-weight:850;letter-spacing:-.04em;color:#1c1917}.card{margin-top:32px;padding:40px 28px;background:#fff;border:1px solid #e9e5df;border-radius:28px;box-shadow:0 20px 60px rgba(65,38,16,.07)}.icon{width:66px;height:66px;margin:0 auto 24px;border-radius:22px;background:#fff1e7;color:#c2410c;display:grid;place-items:center}.label{display:inline-block;color:#b45309;background:#ffedd5;border-radius:999px;padding:7px 12px;font-size:11px;line-height:1;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{font-size:clamp(28px,6vw,38px);line-height:1.12;letter-spacing:-.04em;margin:18px 0 12px}p{color:#625d57;font-size:15px;line-height:1.65;margin:0}.note{margin:24px auto 0;max-width:410px;padding:14px 16px;border-radius:14px;background:#fffbeb;color:#785415;text-align:left;font-size:13px;line-height:1.55}.button{display:inline-flex;justify-content:center;align-items:center;min-height:48px;margin-top:26px;padding:0 24px;border-radius:14px;background:#1c1917;color:#fff;text-decoration:none;font-size:14px;font-weight:700}.button:hover{background:#3f3a36}.button:focus-visible,.admin:focus-visible{outline:3px solid #fb923c;outline-offset:4px}.footer{margin:24px 0 0;font-size:12px;color:#938b83}.admin{color:#746b63;text-underline-offset:3px}@media(max-width:400px){.card{padding:32px 20px;border-radius:22px}}
</style></head><body><main>
<div class="brand" role="img" aria-label="Printly"><svg width="122" height="34" viewBox="0 0 122 34" aria-hidden="true">${printlyLogoGroup(0, 0, 34)}</svg></div>
<section class="card" aria-labelledby="notice-title"><div class="icon" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6.6 6.6a2.1 2.1 0 0 0 3 3l6.6-6.6a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.8-2.8z"/></svg></div>
<span class="label">${escapeHtml(copy.label)}</span><h1 id="notice-title">${escapeHtml(copy.title)}</h1><p>${escapeHtml(copy.message)}</p>
<p class="note">${escapeHtml(MAINTENANCE_PAYMENT_NOTE)}</p><a class="button" href="">Try again</a></section>
<p class="footer">Thank you for your patience. &nbsp;·&nbsp; <a class="admin" href="/admin/login">Administrator sign in</a></p>
</main></body></html>`;
  return new NextResponse(html, {
    status: 503,
    headers: { ...noStoreHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '60' },
  });
}
