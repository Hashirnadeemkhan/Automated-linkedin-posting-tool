import {reviewer,db,json} from '../../../../../lib/server';
import {z} from 'zod';
// A person confirms what happened on LinkedIn for a draft stuck in publishing, publish_uncertain or failed.
const schema=z.object({outcome:z.enum(['posted','not_posted']),post_id:z.string().trim().max(200).optional(),note:z.string().trim().max(2000).optional()});
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const {id}=await params;const p=schema.safeParse(await req.json().catch(()=>null));if(!p.success||!z.string().uuid().safeParse(id).success)return json({error:'Invalid request'},400);
 const {data,error}=await db().rpc('reconcile_draft',{p_id:id,p_actor:user.id,p_outcome:p.data.outcome,p_post_id:p.data.post_id||null,p_note:p.data.note||null});
 return error?json({error:error.message},409):json({status:data});
}
