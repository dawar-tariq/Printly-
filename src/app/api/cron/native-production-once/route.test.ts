import { beforeEach, expect, it, vi } from 'vitest';
const s=vi.hoisted(()=>({auth:true,credential:true,claims:0,sends:0,finish:0}));
vi.mock('@/lib/native-one-shot-auth',()=>({authorizedOneShot:async()=>s.auth}));
vi.mock('@/lib/native-push-server',()=>({nativePushOneShotCredentials:()=>s.credential?{credentials:{},target:'production'}:null,nativePushAccessToken:async()=> 'access',sendNativePush:async()=>{s.sends++;return 'sent';}}));
vi.mock('@/lib/supabase',()=>({createAdminSupabase:()=>({rpc:async(name:string)=>{
 if(name==='claim_printly_prod_token_test_once'){s.claims++;return {data:[{delivery_id:'d',lease_token:'l',order_token:'A-1234567890'}],error:null};}
 if(name==='native_push_order_token')return {data:{token:'A-1234567890'},error:null};
 if(name==='finish_native_push_delivery_logged'){s.finish++;return {data:'sent',error:null};}
 throw new Error('unexpected rpc');
}})}));
import { POST } from './route';
beforeEach(()=>{s.auth=true;s.credential=true;s.claims=0;s.sends=0;s.finish=0;vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:200})));});
it('rejects unauthenticated callers before accessing or sending',async()=>{s.auth=false;expect((await POST(new Request('https://example.test',{method:'POST'}))).status).toBe(401);expect(s.claims).toBe(0);expect(s.sends).toBe(0);});
it('validates with Google before claiming, and sends at most once',async()=>{const response=await POST(new Request('https://example.test',{method:'POST'}));expect(response.status).toBe(200);expect(s.claims).toBe(1);expect(s.sends).toBe(1);expect(s.finish).toBe(1);expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string).validate_only).toBe(true);});
it('does not claim if Google validation fails',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:403})));expect((await POST(new Request('https://example.test',{method:'POST'}))).status).toBe(503);expect(s.claims).toBe(0);expect(s.sends).toBe(0);});
