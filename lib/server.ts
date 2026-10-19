import { createClient } from '@supabase/supabase-js';
import {timingSafeEqual} from 'node:crypto';
export const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
export async function reviewer(req:Request){
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token) return null;
 const {data:{user},error}=await db().auth.getUser(token);
 if(error||!user) return null;
 const {data}=await db().from('reviewers').select('user_id').eq('user_id',user.id).maybeSingle();
 return data?user:null;
}
export function automation(req:Request){const token=req.headers.get('x-automation-secret')||'',expected=process.env.AUTOMATION_SECRET||'';if(!token||!expected)return false;const a=Buffer.from(token),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)}
export const json=(value:unknown,status=200)=>Response.json(value,{status});
