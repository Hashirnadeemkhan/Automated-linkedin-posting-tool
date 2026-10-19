import {reviewer,db,json} from '../../../lib/server';
import {signedPreviews} from '../../../lib/images';
export const runtime='nodejs';
export async function GET(req:Request){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const database=db();const [articles,drafts,connections]=await Promise.all([
  database.from('news_articles').select('id,title,url,summary,source,published_at').order('created_at',{ascending:false}).limit(100),
  database.from('drafts').select('id,article_id,status,current_version,approved_version,linkedin_post_id,created_at,draft_versions(version,body,image_url,feedback,created_at),review_events(version,action,feedback,created_at)').order('created_at',{ascending:false}).limit(100),
  database.from('linkedin_connections').select('member_sub,expires_at').eq('reviewer_id',user.id).maybeSingle()
 ]);
 if(articles.error||drafts.error||connections.error)return json({error:'Dashboard load failed; check second migration'},500);
 // Uploaded pictures are private; give the browser short-lived preview links.
 const previews=await signedPreviews((drafts.data||[]).flatMap(d=>d.draft_versions.map(v=>v.image_url||'')));
 const draftRows=(drafts.data||[]).map(d=>({...d,draft_versions:d.draft_versions.map(v=>({...v,image_preview:v.image_url?previews.get(v.image_url)||(v.image_url.startsWith('https://')?v.image_url:null):null}))}));
 const env=process.env,config={gemini:!!env.GEMINI_API_KEY,linkedin:!!(env.LINKEDIN_CLIENT_ID&&env.LINKEDIN_CLIENT_SECRET&&env.LINKEDIN_REDIRECT_URI),publishing:env.PUBLISH_ENABLED==='true',images:!!env.IMAGE_HOST_ALLOWLIST?.trim()};
 return json({articles:articles.data,drafts:draftRows,connection:connections.data,config});
}
