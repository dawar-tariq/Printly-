import { renderPrintlyEmail, type PrintlyEmailKind } from './transactional-email-templates';

type Claim = { id: string; claim_token: string; kind: PrintlyEmailKind; email: string; owner_name: string | null };
type Config = { projectUrl: string; serviceKey: string; brevoKey: string; fetcher?: typeof fetch };
const allowedProjects = new Set(['https://lgfqetnfazawglwllymb.supabase.co', 'https://rahfmpsdbwbktlobntkm.supabase.co']);

/** Server-side worker. Never log claims, request bodies, credentials, or provider bodies.
 * An ambiguous network/server error is NOT retried automatically: Brevo may
 * have accepted the message before the response was lost. */
export async function dispatchOwnerEmails(config: Config, maxMessages = 10) {
  if (!allowedProjects.has(config.projectUrl) || !config.serviceKey || !config.brevoKey || !Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 10) throw new Error('Invalid email worker configuration');
  const fetcher = config.fetcher ?? fetch;
  const rpc = async (name: string, body: object) => {
    const result = await fetcher(`${config.projectUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!result.ok) throw new Error('Email queue unavailable');
    return result.json() as Promise<unknown>;
  };
  await rpc('queue_owner_subscription_reminders', {});
  const totals = { claimed: 0, accepted: 0, failed: 0, retry: 0, unknown: 0 };
  for (let i = 0; i < maxMessages; i++) {
    const item = await rpc('claim_owner_email', {}) as Claim | null;
    if (!item) break;
    totals.claimed++;
    let outcome: 'sent' | 'failed' | 'retry' | 'unknown' = 'unknown';
    let code = 'unexpected';
    try {
      const email = renderPrintlyEmail(item.kind, item.owner_name);
      const result = await fetcher('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'content-type': 'application/json', 'api-key': config.brevoKey }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ sender: { name: 'Printly', email: 'app.printly@gmail.com' }, to: [{ email: item.email }], subject: email.subject, htmlContent: email.html, textContent: email.text }),
      });
      code = `http_${result.status}`;
      // 2xx means the provider accepted the message, not that it reached inbox.
      outcome = result.ok ? 'sent' : result.status === 429 ? 'retry' : result.status >= 400 && result.status < 500 ? 'failed' : 'unknown';
    } catch { code = 'network_or_render_error'; }
    const finished = await rpc('finish_owner_email', { p_id: item.id, p_claim: item.claim_token, p_outcome: outcome, p_code: code });
    if (finished !== true) throw new Error('Email claim could not be finalized');
    if (outcome === 'sent') totals.accepted++; else totals[outcome]++;
  }
  return totals;
}
