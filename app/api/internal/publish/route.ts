import {automation,json} from '../../../../lib/server';
import {publishDraft} from '../../../../lib/publish';
import {z} from 'zod';
export const runtime='nodejs';
export async function POST(req:Request){
 if(!automation(req))return json({error:'Unauthorized'},401);
 const parsed=z.object({draft_id:z.string().uuid()}).safeParse(await req.json().catch(()=>null));if(!parsed.success)return json({error:'Invalid request'},400);
 const result=await publishDraft(parsed.data.draft_id);
 return json(result.body,result.httpStatus);
}
