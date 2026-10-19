import {reviewer,db,json} from '../../../lib/server';
import {z} from 'zod';

const input=z.object({
 url:z.string().trim().url().max(2000).refine(value=>value.startsWith('https://'),'Use an HTTPS source link'),
 title:z.string().trim().min(8).max(500),
 summary:z.string().trim().max(10000).optional(),
 source:z.string().trim().max(200).optional(),
 published_at:z.string().datetime().nullable().optional()
});

export async function POST(req:Request){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const parsed=input.safeParse(await req.json().catch(()=>null));if(!parsed.success)return json({error:'Enter a valid HTTPS link and title'},400);
 const database=db();
 const {data:existing,error:lookupError}=await database.from('news_articles').select('id').eq('url',parsed.data.url).maybeSingle();
 if(lookupError)return json({error:'Article lookup failed'},500);
 if(existing)return json({article_id:existing.id,already_exists:true});
 const {data,error}=await database.from('news_articles').insert(parsed.data).select('id').single();
 if(error||!data)return json({error:'Article storage failed'},500);
 return json({article_id:data.id,already_exists:false},201);
}
