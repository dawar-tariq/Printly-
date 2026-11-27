import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { authorizedOneShot } from './native-one-shot-auth';
const keys = generateKeyPairSync('rsa',{modulusLength:2048});
const jwk = {...keys.publicKey.export({format:'jwk'}),kid:'test',use:'sig'};
const claims = () => ({iss:'https://token.actions.githubusercontent.com',aud:'printly-production-token-test-810af132',repository_id:'1464323442',ref:'refs/heads/arena/309fdf51-printly',event_name:'push',workflow_ref:'dawar-tariq/Printly-/.github/workflows/native-production-once.yml@refs/heads/arena/309fdf51-printly',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300});
const token = (c: object) => { const parts=[{alg:'RS256',kid:'test'},c].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')); return 'Bearer '+parts.join('.')+'.'+sign('RSA-SHA256',Buffer.from(parts.join('.')),keys.privateKey).toString('base64url'); };
afterEach(()=>vi.unstubAllGlobals());
it('accepts only signed, current OIDC tokens for the exact repository, workflow, ref and audience',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({keys:[jwk]}),{status:200})));
 expect(await authorizedOneShot(token(claims()))).toBe(true);
 for(const changed of [{aud:'other'},{repository_id:'1'},{ref:'refs/heads/main'},{event_name:'workflow_dispatch'},{workflow_ref:'other'},{exp:1},{iat:1}]) expect(await authorizedOneShot(token({...claims(),...changed}))).toBe(false);
 expect(await authorizedOneShot(token(claims()).slice(0,-10)+'AAAAAAAAAA')).toBe(false);
 expect(await authorizedOneShot('Bearer garbage')).toBe(false);
});
