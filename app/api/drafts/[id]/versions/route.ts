import {reviewer,db,json} from '../../../../../lib/server';
import {imageHosts} from '../../../../../lib/publish';
import {isStorageRef,storagePath} from '../../../../../lib/images';
import {z} from 'zod';
const input=z.object({expected_version:z.number().int().positive(),body:z.string().trim().min(10).max(3000),image_url:z.union([z.string().url(),z.literal('')]).optional()});
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const {id}=await params;const p=input.safeParse(await req.json().catch(()=>null));if(!p.success||!z.string().uuid().safeParse(id).success)return json({error:'Post text must be 10 to 3000 characters'},400);
 const url=p.data.image_url||null;
 if(url){
  if(isStorageRef(url)){if(!storagePath(url).startsWith(`${id}/`))return json({error:'Image belongs to another draft'},400)}
  else{const host=new URL(url).hostname.toLowerCase();if(!imageHosts().includes(host)||!url.startsWith('https://'))return json({error:'Image host is not allowed'},400)}
 }
 const {data,error}=await db().rpc('add_draft_version',{p_id:id,p_expected_version:p.data.expected_version,p_actor:user.id,p_body:p.data.body,p_image_url:url});
 return error?json({error:error.message},409):json({version:data},201);
}
