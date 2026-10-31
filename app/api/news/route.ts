import {reviewer,json} from '../../../lib/server';
import {searchNews} from '../../../lib/news';
export const runtime='nodejs';
export const maxDuration=30;
export async function GET(req:Request){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const query=(new URL(req.url).searchParams.get('q')||'all').trim().slice(0,120)||'all';
 const items=await searchNews(query);
 if(!items.length)return json({error:'No news found. Try a different topic.'},502);
 return json({query,items});
}
