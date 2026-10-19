import {reviewer,db,json} from '../../../../../lib/server';
import {z} from 'zod';
const schema=z.object({action:z.enum(['approve','request_changes','reject']),version:z.number().int().positive(),feedback:z.string().max(4000).optional()});
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const {id}=await params;const p=schema.safeParse(await req.json().catch(()=>null));if(!p.success)return json({error:'Invalid review'},400);
 if(p.data.action==='request_changes'&&!p.data.feedback?.trim())return json({error:'Feedback required'},400);
 const {data,error}=await db().rpc('review_draft',{p_id:id,p_version:p.data.version,p_actor:user.id,p_action:p.data.action,p_feedback:p.data.feedback||null});
 return error?json({error:error.message},409):json({status:data});
}
