// Deno requires explicit extensions; the Next.js TypeScript config omits them.
// @ts-expect-error Deno runtime resolves this TypeScript extension.
import { dispatchOwnerEmails } from '../../../src/lib/owner-email-dispatch.ts';

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };

// Protected by a separate long random scheduler secret, not a user JWT. Never
// accept destination addresses or provider credentials from the caller.
async function sameSecret(provided: string, expected: string) {
  if (provided.length > 256 || expected.length < 32) return false;
  const encoder = new TextEncoder();
  const [a,b] = await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(provided)),crypto.subtle.digest('SHA-256',encoder.encode(expected))]);
  return new Uint8Array(a).reduce((diff, byte, i) => diff | (byte ^ new Uint8Array(b)[i]),0) === 0;
}
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(null,{status:405});
  const secret = Deno.env.get('OWNER_EMAIL_WORKER_SECRET') ?? '';
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /,'') ?? '';
  if (!await sameSecret(supplied, secret)) return new Response(null,{status:401});
  try {
    const totals = await dispatchOwnerEmails({ projectUrl: Deno.env.get('SUPABASE_URL') ?? '', serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', brevoKey: Deno.env.get('BREVO_API_KEY') ?? '' });
    return Response.json(totals, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Email dispatch failed' }, { status:503,headers:{'cache-control':'no-store'} });
  }
});
