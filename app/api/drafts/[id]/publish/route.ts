import {reviewer,json} from '../../../../../lib/server';
import {publishDraft} from '../../../../../lib/publish';
import {z} from 'zod';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const {id}=await params;if(!z.string().uuid().safeParse(id).success)return json({error:'Invalid draft'},400);
 const result=await publishDraft(id);
 return json(result.body,result.httpStatus);
}
