import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

// Usage: node scripts/provision-reviewer.mjs [email]   (defaults to the original reviewer)
const email=(process.argv[2]||'khashir657@gmail.com').trim().toLowerCase();
if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new Error(`Not a valid email: ${email}`);
console.log(`Reviewer: ${email}`);
const values=Object.fromEntries(readFileSync(new URL('../.env.local',import.meta.url),'utf8')
 .split(/\r?\n/).filter(line=>/^[A-Z][A-Z0-9_]*=/.test(line))
 .map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1)]}));
if(!values.NEXT_PUBLIC_SUPABASE_URL||!values.NEXT_PUBLIC_SUPABASE_ANON_KEY||!values.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Supabase credentials are missing from .env.local');
const projectRef=JSON.parse(Buffer.from(values.SUPABASE_SERVICE_ROLE_KEY.split('.')[1],'base64url').toString('utf8')).ref;
const anonRef=JSON.parse(Buffer.from(values.NEXT_PUBLIC_SUPABASE_ANON_KEY.split('.')[1],'base64url').toString('utf8')).ref;
if(new URL(values.NEXT_PUBLIC_SUPABASE_URL).hostname!==`${projectRef}.supabase.co`||anonRef!==projectRef)throw new Error('Supabase URL and keys belong to different projects');

process.stdout.write('Enter reviewer password (input is not saved): ');
const password=await new Promise((resolve,reject)=>{
 let input='';
 process.stdin.setEncoding('utf8');
 if(process.stdin.isTTY)process.stdin.setRawMode(true);
 process.stdin.on('data',chunk=>{input+=chunk;if(input.includes('\r')||input.includes('\n')){if(process.stdin.isTTY)process.stdin.setRawMode(false);resolve(input.split(/[\r\n]/,1)[0])}});
 process.stdin.on('end',()=>resolve(input.trimEnd()));
 process.stdin.on('error',reject);
});
if(!password||password.length<8)throw new Error('Password must be at least 8 characters');

const supabase=createClient(values.NEXT_PUBLIC_SUPABASE_URL,values.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let existing;
for(let page=1;page<=100;page++){
 const {data,error}=await supabase.auth.admin.listUsers({page,perPage:1000});
 if(error)throw new Error(`Could not list Supabase Auth users: ${error.message}`);
 existing=data.users.find(user=>user.email?.toLowerCase()===email);
 if(existing||data.users.length<1000)break;
}

let userId;
if(existing){
 const {data,error}=await supabase.auth.admin.updateUserById(existing.id,{password,email_confirm:true});
 if(error)throw new Error(`Could not update reviewer login: ${error.message}`);
 userId=data.user?.id;
 console.log('Existing reviewer password updated and email confirmed.');
}else{
 const {data,error}=await supabase.auth.admin.createUser({email,password,email_confirm:true});
 if(error)throw new Error(`Could not create reviewer login: ${error.message}`);
 userId=data.user?.id;
 console.log('Reviewer Auth account created and email confirmed.');
}
if(!userId)throw new Error('Supabase did not return a user ID');
const {error:roleError}=await supabase.from('reviewers').upsert({user_id:userId},{onConflict:'user_id'});
if(roleError)throw new Error(`Login was updated, but reviewer grant failed: ${roleError.message}. Run supabase/03_add_reviewer.sql.`);

const signIn=createClient(values.NEXT_PUBLIC_SUPABASE_URL,values.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:login,error:loginError}=await signIn.auth.signInWithPassword({email,password});
if(loginError||!login.user)throw new Error(`Reviewer was provisioned, but login verification failed: ${loginError?.message||'No user returned'}`);
await signIn.auth.signOut();
console.log('Reviewer access granted. Email/password login verified successfully.');
