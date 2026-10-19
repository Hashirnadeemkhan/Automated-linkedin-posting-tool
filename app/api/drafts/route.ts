import {reviewer,db,json} from '../../../lib/server';
import {readArticle} from '../../../lib/news';
import {writePost} from '../../../lib/gemini';
import {z} from 'zod';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:Request){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const parsed=z.object({article_id:z.string().uuid()}).safeParse(await req.json().catch(()=>null));if(!parsed.success)return json({error:'Invalid input'},400);
 const database=db();const {data:article}=await database.from('news_articles').select('*').eq('id',parsed.data.article_id).single();
 if(!article)return json({error:'Article not found'},404);
 let body:string;
 try{body=await writePost({article,articleText:await readArticle(article.url)})}
 catch(e){return json({error:e instanceof Error?e.message:'Draft generation failed'},502)}
 const {data:draft,error}=await database.from('drafts').insert({article_id:article.id}).select().single();if(error||!draft)return json({error:'Draft creation failed'},500);
 const saved=await database.from('draft_versions').insert({draft_id:draft.id,version:1,body});
 if(saved.error){await database.from('drafts').delete().eq('id',draft.id);return json({error:'Version storage failed'},500)}
 return json({draft_id:draft.id,version:1,body},201);
}
