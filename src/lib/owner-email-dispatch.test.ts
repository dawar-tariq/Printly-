import { describe, expect, it, vi } from 'vitest';
import { dispatchOwnerEmails } from './owner-email-dispatch';

const base={projectUrl:'https://lgfqetnfazawglwllymb.supabase.co',serviceKey:'service-test',brevoKey:'brevo-test'};
function fixture(providerStatus: number | 'network') {
  const calls: Array<{url:string,body:Record<string,unknown>}> = [];
  let claimed=false;
  const fetcher=vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u=String(url); const body=JSON.parse(String(init?.body ?? '{}')) as Record<string,unknown>; calls.push({url:u,body});
    if(u.endsWith('queue_owner_subscription_reminders')) return Response.json(0);
    if(u.endsWith('claim_owner_email')) { if(claimed)return Response.json(null); claimed=true; return Response.json({id:'id',claim_token:'token',kind:'verified',email:'owner@example.test',owner_name:'Owner'}); }
    if(u.endsWith('finish_owner_email')) return Response.json(true);
    if(u==='https://api.brevo.com/v3/smtp/email') { if(providerStatus==='network')throw new Error('connection lost'); return new Response('{}',{status:providerStatus}); }
    throw new Error('unexpected URL');
  }) as unknown as typeof fetch;
  return {fetcher,calls};
}
describe('owner email worker',()=>{
  it.each([[201,'sent'],[429,'retry'],[400,'failed'],[500,'unknown'],['network','unknown']] as const)('classifies %s as %s',async(status,outcome)=>{
    const f=fixture(status); const counts=await dispatchOwnerEmails({...base,fetcher:f.fetcher});
    expect(counts.claimed).toBe(1);
    expect(f.calls.find(c=>c.url.endsWith('finish_owner_email'))?.body.p_outcome).toBe(outcome);
    const sent=f.calls.find(c=>c.url.includes('brevo.com'))?.body;
    expect(sent?.subject).toBe('Your shop application has been verified');
    expect(JSON.stringify(sent)).toContain('subscription access are checked separately');
  });
  it('fails closed on unexpected project hosts',async()=>{
    const f=fixture(201); await expect(dispatchOwnerEmails({...base,projectUrl:'https://attacker.example',fetcher:f.fetcher})).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
