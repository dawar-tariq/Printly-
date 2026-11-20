import { createHash } from 'node:crypto';
import { getStaffContext } from '@/lib/api';
import { StandeeTextError } from '@/lib/standee/fonts';
import { renderStandeePdf, renderStandeePng } from '@/lib/standee/render';
import { isStandeeTheme, standeeOrderUrl, type StandeeInfo } from '@/lib/standee/shared';
import { standeeSvg } from '@/lib/standee/svg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const printCsp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function errorResponse(status: number, code: string, message: string, isPrint = false) {
  if (isPrint) {
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Printly standee</title></head><body style="font:16px system-ui,sans-serif;padding:2rem;line-height:1.5"><h1>Could not open the standee</h1><p>${escapeHtml(message)}</p><p><a href="/shop/standee">Return to QR standee</a></p></body></html>`, {
      status, headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': printCsp },
    });
  }
  return Response.json({ error: { code, message } }, { status, headers: privateHeaders });
}

function printDocument(png: Buffer) {
  // No saved details or request data are interpolated into this document. The
  // image is the exact 300-dpi artwork generated for this authenticated request.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Printly QR standee</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f5f3f0;color:#1c1917;font:15px/1.5 system-ui,sans-serif}.toolbar{max-width:740px;margin:0 auto;padding:18px}.toolbar h1{font-size:20px;margin:0 0 4px}.toolbar p{margin:4px 0 12px}.toolbar button{background:#c2410c;color:white;border:0;border-radius:10px;padding:11px 18px;font-weight:700;cursor:pointer}.page{display:block;width:min(100%,740px);height:auto;margin:0 auto;background:white;box-shadow:0 2px 14px #0002}@page{size:A4 portrait;margin:0}@media print{body{background:white}.toolbar{display:none}.page{width:210mm;height:297mm;margin:0;box-shadow:none;max-width:none}}
    </style></head><body><div class="toolbar"><h1>Print your standee</h1><p>Choose A4, portrait and actual size (100%). Turn off headers and footers, then check the print preview before printing.</p><button type="button" id="print-button">Print standee</button></div><img class="page" id="standee" src="data:image/png;base64,${png.toString('base64')}" alt="Your Printly QR standee"><script>document.getElementById('print-button').addEventListener('click',function(){window.print()});window.addEventListener('load',function(){if(document.getElementById('standee').naturalWidth){setTimeout(function(){window.print()},200)}})</script></body></html>`;
}

/** All formats resolve the shop from the authenticated membership, never a request parameter. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const format = params.get('format') ?? 'preview';
  const isPrint = format === 'print';
  try {
    const staff = await getStaffContext();
    if (!staff || staff.isAdmin || staff.shopIds.length === 0) {
      return errorResponse(403, 'no_shop', 'Sign in to an account linked to a shop to create a standee.', isPrint);
    }
    if (!['preview', 'pdf', 'png', 'print'].includes(format)) {
      return errorResponse(400, 'invalid_format', 'Choose a valid standee format.');
    }
    const theme = params.get('theme') ?? 'orange';
    if (!isStandeeTheme(theme)) return errorResponse(400, 'invalid_theme', 'Choose an approved Printly colour.', isPrint);

    // The same first membership is used by the existing shop workspace. A
    // shop_id or any other caller-provided identifier is deliberately ignored.
    const shopId = staff.shopIds[0];
    const { data: shop, error: shopError } = await staff.admin.from('shops')
      .select('id, owner_id, name, short_code, status, kyc_status').eq('id', shopId).maybeSingle();
    if (shopError) return errorResponse(500, 'db', 'Could not load your shop. Please try again.', isPrint);
    if (!shop) return errorResponse(404, 'no_shop', 'Your linked shop was not found.', isPrint);
    const { data: owner, error: ownerError } = await staff.admin.from('profiles')
      .select('full_name').eq('id', shop.owner_id).maybeSingle();
    if (ownerError) return errorResponse(500, 'db', 'Could not load the shop owner. Please try again.', isPrint);
    if (!owner?.full_name?.trim()) return errorResponse(422, 'missing_owner', 'The shop owner’s name is missing. Please contact support before creating a standee.', isPrint);

    let orderUrl: string;
    try { orderUrl = standeeOrderUrl(process.env.NEXT_PUBLIC_SITE_URL, shop.short_code); }
    catch { return errorResponse(503, 'site_url', 'The shop link is not configured correctly. Please contact support.', isPrint); }
    const info: StandeeInfo = {
      shop_name: shop.name,
      owner_name: owner.full_name,
      short_code: shop.short_code,
      order_url: orderUrl,
      status: shop.status,
      kyc_status: shop.kyc_status,
    };
    const revision = createHash('sha256').update(JSON.stringify({ version: 1, shopId, info, theme })).digest('hex');
    // Downloads and print must match the visible preview. If shop details change,
    // require regeneration instead of silently producing a different standee.
    if (format !== 'preview' && params.get('revision') !== revision) {
      return errorResponse(409, 'standee_changed', 'Shop details have changed or this preview has expired. Generate the standee again.', isPrint);
    }
    const svg = standeeSvg(info, theme);
    if (format === 'preview') {
      const png = await renderStandeePng(svg);
      return Response.json({ info, revision, theme, preview: `data:image/png;base64,${png.toString('base64')}` }, { headers: privateHeaders });
    }
    if (format === 'pdf') {
      const pdf = await renderStandeePdf(svg);
      return new Response(new Uint8Array(pdf), { headers: {
        ...privateHeaders, 'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="printly-standee-${shop.short_code}.pdf"`,
      } });
    }
    const png = await renderStandeePng(svg, true);
    if (isPrint) {
      return new Response(printDocument(png), { headers: {
        ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': printCsp,
      } });
    }
    return new Response(new Uint8Array(png), { headers: {
      ...privateHeaders, 'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="printly-standee-${shop.short_code}.png"`,
    } });
  } catch (error) {
    if (error instanceof StandeeTextError) return errorResponse(422, 'standee_text', error.message, isPrint);
    console.error('Standee generation failed:', error);
    return errorResponse(500, 'standee_failed', 'Could not generate your standee. Please try again.', isPrint);
  }
}
