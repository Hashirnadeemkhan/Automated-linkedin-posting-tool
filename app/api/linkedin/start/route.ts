import {randomBytes} from 'node:crypto';
import {reviewer,json} from '../../../../lib/server';
import {encrypt} from '../../../../lib/crypto';
export async function POST(req:Request){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const {LINKEDIN_CLIENT_ID,LINKEDIN_REDIRECT_URI}=process.env;if(!LINKEDIN_CLIENT_ID||!LINKEDIN_REDIRECT_URI)return json({error:'LinkedIn OAuth not configured'},503);
 const state=randomBytes(24).toString('hex'),value=encrypt(JSON.stringify({state,user_id:user.id,expires:Date.now()+600000}));
 const url=new URL('https://www.linkedin.com/oauth/v2/authorization');url.searchParams.set('response_type','code');url.searchParams.set('client_id',LINKEDIN_CLIENT_ID);url.searchParams.set('redirect_uri',LINKEDIN_REDIRECT_URI);url.searchParams.set('state',state);url.searchParams.set('scope','openid profile w_member_social');
 const response=json({url:url.toString()});response.headers.append('Set-Cookie',`linkedin_oauth=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/api/linkedin/callback; Max-Age=600`);return response;
}
