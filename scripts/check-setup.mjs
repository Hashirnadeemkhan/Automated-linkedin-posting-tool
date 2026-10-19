// Read-only setup check. Prints no secrets. Run: node scripts/check-setup.mjs [reviewer email]
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

const reviewerEmail=(process.argv[2]||'khashir657@gmail.com').trim().toLowerCase();
const v=Object.fromEntries(readFileSync(new URL('../.env.local',import.meta.url),'utf8')
 .split(/\r?\n/).filter(line=>/^[A-Z][A-Z0-9_]*=/.test(line))
 .map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).trim()]}));
const ok=(pass,label,hint='')=>console.log(`${pass?'OK  ':'FAIL'} ${label}${!pass&&hint?` -> ${hint}`:''}`);

console.log('--- .env.local');
for(const k of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','GEMINI_API_KEY','AUTOMATION_SECRET','TOKEN_ENCRYPTION_KEY','APP_URL'])ok(!!v[k],k,'missing');
ok(Buffer.from(v.TOKEN_ENCRYPTION_KEY||'','base64').length===32,'TOKEN_ENCRYPTION_KEY is 32 bytes');
ok(!!(v.LINKEDIN_CLIENT_ID&&v.LINKEDIN_CLIENT_SECRET),'LinkedIn client ID/secret','needed only for LinkedIn connect/publish');
ok(v.LINKEDIN_REDIRECT_URI===`${(v.APP_URL||'').replace(/\/$/,'')}/api/linkedin/callback`,'LINKEDIN_REDIRECT_URI matches APP_URL');

console.log('--- Supabase');
const s=createClient(v.NEXT_PUBLIC_SUPABASE_URL,v.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let user;
for(let page=1;page<=100;page++){
 const {data,error}=await s.auth.admin.listUsers({page,perPage:1000});
 if(error){ok(false,'Service role key works',error.message);process.exit(1)}
 user=data.users.find(u=>u.email?.toLowerCase()===reviewerEmail);
 if(user||data.users.length<1000)break;
}
ok(!!user,`Auth user ${reviewerEmail} exists`,'run node scripts/provision-reviewer.mjs');
if(user){
 ok(!!user.email_confirmed_at,'Email confirmed','run node scripts/provision-reviewer.mjs');
 ok(!user.banned_until||new Date(user.banned_until)<new Date(),'User not banned');
 ok((user.app_metadata?.providers||[]).includes('email'),'Email/password provider enabled for user',`providers: ${(user.app_metadata?.providers||[]).join(',')}`);
 const r=await s.from('reviewers').select('user_id').eq('user_id',user.id).maybeSingle();
 ok(!r.error&&!!r.data,'Reviewer access granted',r.error?.message||'run supabase/03_add_reviewer.sql');
}
for(const t of ['news_articles','drafts','draft_versions','review_events','publish_attempts','linkedin_connections']){
 const q=await s.from(t).select('*',{count:'exact',head:true});ok(!q.error,`Table ${t}${q.error?'':` (${q.count} rows)`}`,q.error?.message);
}
const rec=await s.rpc('reconcile_draft',{p_id:'00000000-0000-0000-0000-000000000000',p_actor:'00000000-0000-0000-0000-000000000000',p_outcome:'posted'});
ok(!/function .* does not exist|Could not find the function/i.test(rec.error?.message||''),'04_production.sql applied','run supabase/04_production.sql in SQL Editor');

if(v.GEMINI_API_KEY){
 console.log('--- Gemini');
 const g=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(v.GEMINI_MODEL||'gemini-3.8-flash')}`,{headers:{'x-goog-api-key':v.GEMINI_API_KEY}}).catch(e=>({ok:false,status:e.message}));
 ok(g.ok,`Gemini model ${v.GEMINI_MODEL} reachable`,`HTTP ${g.status}; check GEMINI_API_KEY / GEMINI_MODEL`);
}
