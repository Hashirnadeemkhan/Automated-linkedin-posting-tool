import {db} from './server';
import {decrypt,encrypt} from './crypto';
import {isStorageRef,downloadStored} from './images';

const version=process.env.LINKEDIN_API_VERSION||'202605';
const liHeaders=(token:string)=>({authorization:`Bearer ${token}`,'Linkedin-Version':version,'X-Restli-Protocol-Version':'2.0.0','content-type':'application/json'});
export const imageHosts=()=>(process.env.IMAGE_HOST_ALLOWLIST||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
export type PublishResult={httpStatus:number;body:Record<string,unknown>};

// LinkedIn "little text" format: reserved characters must be escaped or the post is cut off; hashtags use a template.
export function littleText(text:string){
 const escape=(s:string)=>s.replace(/[\\|{}@[\]()<>*_~#]/g,m=>'\\'+m);
 return text.split(/(#[\p{L}\p{N}]+)/u).map(part=>/^#[\p{L}\p{N}]+$/u.test(part)?'{hashtag|\\#|'+part.slice(1)+'}':escape(part)).join('');
}

async function loadImage(ref:string){
 if(isStorageRef(ref))return downloadStored(ref);
 const source=new URL(ref);
 if(source.protocol!=='https:'||!imageHosts().includes(source.hostname.toLowerCase())||source.port||source.username||source.password)throw new Error('Image URL is not approved');
 const imageRes=await fetch(source,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});if(!imageRes.ok)throw new Error('Image download failed');
 const type=imageRes.headers.get('content-type')?.split(';')[0]||'';if(!['image/jpeg','image/png'].includes(type))throw new Error('Image must be JPEG or PNG');
 const bytes=Buffer.from(await imageRes.arrayBuffer());if(bytes.length>8_000_000)throw new Error('Image exceeds 8 MB');
 return {bytes,type};
}

async function uploadImage(ref:string,owner:string,token:string){
 const {bytes,type}=await loadImage(ref);
 const init=await fetch('https://api.linkedin.com/rest/images?action=initializeUpload',{method:'POST',headers:liHeaders(token),body:JSON.stringify({initializeUploadRequest:{owner}}),cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!init.ok)throw new Error(`Image initialization failed: ${init.status}`);const value=(await init.json()).value;
 if(!value?.uploadUrl||!value?.image)throw new Error('Image initialization response incomplete');
 const uploadUrl=new URL(value.uploadUrl);if(uploadUrl.protocol!=='https:'||!(uploadUrl.hostname==='linkedin.com'||uploadUrl.hostname.endsWith('.linkedin.com')))throw new Error('Unexpected LinkedIn upload host');
 const uploaded=await fetch(uploadUrl,{method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':type!},body:bytes,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60000)});if(!uploaded.ok)throw new Error(`Image upload failed: ${uploaded.status}`);
 return value.image as string;
}

// Claims one approved draft, posts it to the approver's LinkedIn account and records the attempt.
export async function publishDraft(draftId:string):Promise<PublishResult>{
 if(process.env.PUBLISH_ENABLED!=='true')return {httpStatus:503,body:{error:'Publishing is disabled (PUBLISH_ENABLED=false)'}};
 const database=db();const {data,error}=await database.rpc('claim_approved_draft',{p_id:draftId});
 if(error)return {httpStatus:500,body:{error:'Claim failed',detail:error.message}};if(!data?.length)return {httpStatus:409,body:{error:'Not approved or already claimed'}};
 const item=data[0];let postRequested=false;
 async function finish(state:'succeeded'|'uncertain'|'failed',postId:string|null,response:Record<string,unknown>,code:string|null){await database.rpc('finish_publish_attempt',{p_attempt:item.attempt_id,p_state:state,p_post_id:postId,p_response:response,p_error_code:code})}
 try{
  const {data:connection,error:connectionError}=await database.from('linkedin_connections').select('*').eq('reviewer_id',item.approved_by).maybeSingle();if(connectionError||!connection)throw new Error('LinkedIn account is not connected');
  let access=decrypt(connection.access_token_ciphertext);
  if(new Date(connection.expires_at).getTime()<Date.now()+60000){
   if(!connection.refresh_token_ciphertext||!connection.refresh_expires_at||new Date(connection.refresh_expires_at).getTime()<Date.now()+60000)throw new Error('LinkedIn token expired; reconnect account');
   const refresh=decrypt(connection.refresh_token_ciphertext);const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh,client_id:process.env.LINKEDIN_CLIENT_ID!,client_secret:process.env.LINKEDIN_CLIENT_SECRET!});
   const result=await fetch('https://www.linkedin.com/oauth/v2/accessToken',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,cache:'no-store',signal:AbortSignal.timeout(20000)});if(!result.ok)throw new Error('LinkedIn token refresh failed');const t=await result.json();if(!t.access_token||!t.expires_in)throw new Error('Invalid token refresh response');access=t.access_token;
   const {error:saveError}=await database.from('linkedin_connections').update({access_token_ciphertext:encrypt(access),refresh_token_ciphertext:t.refresh_token?encrypt(t.refresh_token):connection.refresh_token_ciphertext,expires_at:new Date(Date.now()+t.expires_in*1000).toISOString(),refresh_expires_at:t.refresh_token_expires_in?new Date(Date.now()+t.refresh_token_expires_in*1000).toISOString():connection.refresh_expires_at,updated_at:new Date().toISOString()}).eq('reviewer_id',item.approved_by);if(saveError)throw new Error('Refreshed token storage failed');
  }
  const owner=`urn:li:person:${connection.member_sub}`;const media=item.image_url?await uploadImage(item.image_url,owner,access):null;
  const payload={author:owner,commentary:littleText(item.body),visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:'PUBLISHED',...(media?{content:{media:{id:media}}}:{})};
  postRequested=true;
  const response=await fetch('https://api.linkedin.com/rest/posts',{method:'POST',headers:liHeaders(access),body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(30000)});
  const postId=response.headers.get('x-restli-id');
  if(response.status===201&&postId){await finish('succeeded',postId,{http_status:201,post_id:postId},null);return {httpStatus:200,body:{status:'published',post_id:postId}}}
  await finish('uncertain',null,{http_status:response.status,post_id:postId},'ambiguous_post_response');return {httpStatus:502,body:{status:'publish_uncertain',error:'LinkedIn response unclear; check the profile before any retry'}};
 }catch(e){const message=e instanceof Error?e.message:String(e),code=postRequested?'ambiguous_post_request':'pre_post_failure';await finish(postRequested?'uncertain':'failed',null,{message},code);return {httpStatus:postRequested?502:503,body:{status:postRequested?'publish_uncertain':'failed',error:message}}}
}
