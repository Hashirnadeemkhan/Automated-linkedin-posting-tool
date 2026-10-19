import {automation,db,json} from '../../../../lib/server';
import {z} from 'zod';
const input=z.object({url:z.string().url(),title:z.string().min(8).max(500),summary:z.string().max(10000).optional(),source:z.string().max(200).optional(),published_at:z.string().datetime().optional()});
export async function POST(req:Request){
 if(!automation(req))return json({error:'Unauthorized'},401);
 const parsed=input.safeParse(await req.json().catch(()=>null));if(!parsed.success)return json({error:'Invalid article'},400);
 const {data,error}=await db().from('news_articles').upsert(parsed.data,{onConflict:'url'}).select().single();
 return error?json({error:'Storage failed'},500):json({article:data});
}
