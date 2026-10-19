import {db} from '../../../../lib/server';
export const runtime='nodejs';
import {decrypt,encrypt} from '../../../../lib/crypto';
function redirect(message:string){const url=new URL('/',process.env.APP_URL);url.searchParams.set('linkedin',message);return new Response(null,{status:303,headers:{location:url.toString(),'set-cookie':'linkedin_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/linkedin/callback; Max-Age=0'}})}
export async function GET(req:Request){
 try{
  const url=new URL(req.url);
  if(url.searchParams.get('error'))throw new Error(`${url.searchParams.get('error')}: ${url.searchParams.get('error_description')||'LinkedIn refused the request'}`);
  const cookie=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('linkedin_oauth='))?.slice(15);if(!cookie)throw new Error('Missing OAuth state');
  const saved=JSON.parse(decrypt(decodeURIComponent(cookie)));if(saved.state!==url.searchParams.get('state')||Date.now()>saved.expires||!url.searchParams.get('code'))throw new Error('Invalid OAuth state');
  const body=new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code')!,redirect_uri:process.env.LINKEDIN_REDIRECT_URI!,client_id:process.env.LINKEDIN_CLIENT_ID!,client_secret:process.env.LINKEDIN_CLIENT_SECRET!});
  const tokenRes=await fetch('https://www.linkedin.com/oauth/v2/accessToken',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,cache:'no-store',signal:AbortSignal.timeout(20000)});if(!tokenRes.ok)throw new Error('Token exchange failed');
  const token=await tokenRes.json();if(!token.access_token||!token.expires_in||!token.scope?.includes('w_member_social'))throw new Error('Required posting scope missing');
  const profileRes=await fetch('https://api.linkedin.com/v2/userinfo',{headers:{authorization:`Bearer ${token.access_token}`},cache:'no-store',signal:AbortSignal.timeout(20000)});if(!profileRes.ok)throw new Error('LinkedIn profile lookup failed');const profile=await profileRes.json();if(!profile.sub)throw new Error('LinkedIn member ID missing');
  const record={reviewer_id:saved.user_id,member_sub:profile.sub,access_token_ciphertext:encrypt(token.access_token),refresh_token_ciphertext:token.refresh_token?encrypt(token.refresh_token):null,expires_at:new Date(Date.now()+token.expires_in*1000).toISOString(),refresh_expires_at:token.refresh_token_expires_in?new Date(Date.now()+token.refresh_token_expires_in*1000).toISOString():null,updated_at:new Date().toISOString()};
  const {error}=await db().from('linkedin_connections').upsert(record,{onConflict:'reviewer_id'});if(error)throw error;
  return redirect('connected');
 }catch(e){return redirect(e instanceof Error?e.message:'Connection failed')}
}
