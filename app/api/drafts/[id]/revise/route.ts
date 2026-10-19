import {reviewer,db,json} from '../../../../../lib/server';
import {readArticle} from '../../../../../lib/news';
import {writePost} from '../../../../../lib/gemini';
import {z} from 'zod';
export const runtime='nodejs';
export const maxDuration=60;
// Records the reviewer's feedback, has Gemini rewrite the draft with it, and saves the result as a new version for review.
const schema=z.object({version:z.number().int().positive(),feedback:z.string().trim().min(3).max(4000)});
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const {id}=await params;const p=schema.safeParse(await req.json().catch(()=>null));
 if(!p.success||!z.string().uuid().safeParse(id).success)return json({error:'Write what the AI should change first'},400);
 const database=db();
 const {data:draft}=await database.from('drafts').select('id,status,current_version,article_id').eq('id',id).single();
 if(!draft||draft.current_version!==p.data.version)return json({error:'This draft changed in the meantime. Refresh and try again.'},409);
 if(draft.status==='pending_review'){
  const {error}=await database.rpc('review_draft',{p_id:id,p_version:p.data.version,p_actor:user.id,p_action:'request_changes',p_feedback:p.data.feedback});
  if(error)return json({error:error.message},409);
 }else if(draft.status!=='changes_requested')return json({error:'Only drafts waiting for review can be revised'},409);
 const [{data:article},{data:current}]=await Promise.all([
  database.from('news_articles').select('*').eq('id',draft.article_id).single(),
  database.from('draft_versions').select('body,image_url').eq('draft_id',id).eq('version',p.data.version).single()
 ]);
 if(!article||!current)return json({error:'Draft source is missing'},404);
 let body:string;
 try{body=await writePost({article,articleText:await readArticle(article.url),current:current.body,feedback:p.data.feedback})}
 catch(e){return json({error:`${e instanceof Error?e.message:'Revision failed'}. Your feedback was saved; click Revise again to retry.`},502)}
 const {data:version,error}=await database.rpc('add_draft_version',{p_id:id,p_expected_version:p.data.version,p_actor:user.id,p_body:body,p_image_url:current.image_url});
 return error?json({error:error.message},409):json({version,body},201);
}
