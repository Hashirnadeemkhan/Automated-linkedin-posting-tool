import {isIP} from 'node:net';
import {trustOf,cleanSource,type Trust} from './sources';

export type NewsItem={title:string;url:string;source:string;summary:string;published_at:string|null;trust:Trust};

const UA='Mozilla/5.0 (compatible; ImmigrationNewsReview/1.0)';
const DAY=86_400_000;

export function decodeEntities(s:string){
 return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
  .replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16)))
  .replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(Number(d)))
  .replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
}
const tag=(xml:string,name:string)=>{const m=xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`,'i'));return m?decodeEntities(m[1]).trim():''};
const plain=(html:string)=>decodeEntities(html.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const isoDate=(s:string)=>{const d=new Date(s);return Number.isNaN(d.getTime())?null:d.toISOString()};

async function getText(url:string){
 const r=await fetch(url,{headers:{'user-agent':UA},cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error(`Feed returned ${r.status}`);
 return r.text();
}

// Official government feeds. `filter` is set for feeds that also carry non-immigration news.
type Region='usa'|'uk'|'canada';
const OFFICIAL:{url:string;source:string;region:Region;filter?:boolean}[]=[
 {url:'https://www.uscis.gov/news/rss-feed/23269',source:'USCIS',region:'usa'},
 {url:'https://www.uscis.gov/news/rss-feed/22984',source:'USCIS',region:'usa'},
 {url:'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=uk-visas-and-immigration',source:'GOV.UK – UK Visas and Immigration',region:'uk'},
 {url:'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=home-office',source:'GOV.UK – Home Office',region:'uk',filter:true},
 {url:'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=departmentofcitizenshipandimmigration&type=newsreleases&sort=publishedDate&orderBy=desc&pick=30&format=atom',source:'IRCC – Government of Canada',region:'canada'}
];

// Preset topics run several searches so the list covers the whole subject, not one query's top results.
const PRESETS:Record<string,{queries:string[];official:Region[]}>={
 all:{queries:['immigration','immigration policy','visa rules','USCIS','H-1B','green card','asylum seekers','deportation','Canada immigration IRCC','UK Home Office visa','Australia immigration visa','student visa'],official:['usa','uk','canada']},
 usa:{queries:['US immigration','USCIS','H-1B','green card','ICE deportation','US visa State Department','US asylum'],official:['usa']},
 uk:{queries:['UK immigration','UK visa','Home Office asylum','UK skilled worker visa'],official:['uk']},
 canada:{queries:['Canada immigration','IRCC','Express Entry','Canada study permit','Canada work permit'],official:['canada']}
};

const RELEVANT=/immigra|migra|visa|asylum|refugee|deport|green card|h-?1b|uscis|ircc|citizenship|naturali[sz]|border|work permit|study permit|express entry|resettle|sponsor|residen|passport|\bice\b|home office|ukvi|e-?verify/i;
const OFF_TOPIC=/visa (inc|card|credit|debit|stock|shares|earnings)|visa's (stock|shares|earnings)|mastercard|payments? network/i;
const relevant=(x:NewsItem)=>RELEVANT.test(`${x.title} ${x.summary}`)&&!OFF_TOPIC.test(`${x.title} ${x.summary}`);

const entries=(xml:string)=>[...xml.matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/g)].map(m=>m[2]);

async function official(feed:typeof OFFICIAL[number]):Promise<NewsItem[]>{
 const xml=await getText(feed.url);
 return entries(xml).map(item=>{
  const url=decodeEntities(item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1]||tag(item,'link'));
  const summary=plain(tag(item,'summary')||tag(item,'description')||tag(item,'content')).slice(0,400);
  return {title:plain(tag(item,'title')),url,source:feed.source,summary,published_at:isoDate(tag(item,'pubDate')||tag(item,'published')||tag(item,'updated')),trust:'official' as Trust};
 }).filter(x=>x.url.startsWith('https://')&&(!feed.filter||relevant(x)));
}

// Bing News RSS links wrap the publisher URL in a click-tracking redirect; unwrap it.
async function bing(query:string):Promise<NewsItem[]>{
 const xml=await getText(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&count=30&qft=${encodeURIComponent('sortbydate="1"')}`);
 return entries(xml).flatMap(item=>{
  let url=tag(item,'link');
  try{const u=new URL(url);if(u.hostname.endsWith('bing.com')&&u.searchParams.get('url'))url=u.searchParams.get('url')!}catch{return []}
  if(!url.startsWith('https://'))return [];
  const source=cleanSource(plain(tag(item,'News:Source')));
  return [{title:plain(tag(item,'title')),url,source,summary:plain(tag(item,'description')),published_at:isoDate(tag(item,'pubDate')),trust:trustOf(url,source)}];
 });
}

// Google News RSS is the fallback. Its links open via news.google.com, so article text cannot be read.
async function google(query:string):Promise<NewsItem[]>{
 const xml=await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(query+' when:3d')}&hl=en-US&gl=US&ceid=US:en`);
 return entries(xml).map(item=>{
  const source=plain(tag(item,'source'));let title=plain(tag(item,'title'));
  if(source&&title.endsWith(` - ${source}`))title=title.slice(0,-(source.length+3));
  const url=tag(item,'link');
  return {title,url,source,summary:'',published_at:isoDate(tag(item,'pubDate')),trust:trustOf(url,source)};
 }).filter(x=>x.url.startsWith('https://'));
}

async function settled(jobs:Promise<NewsItem[]>[]){return (await Promise.allSettled(jobs)).flatMap(r=>r.status==='fulfilled'?r.value:[])}
const RANK:Record<Trust,number>={official:0,trusted:1,other:2};
const cache=new Map<string,{at:number;items:NewsItem[]}>();

// `topic` is a preset key (all, usa, uk, canada) or free text.
export async function searchNews(topic:string):Promise<NewsItem[]>{
 const key=topic.trim().toLowerCase();
 const hit=cache.get(key);if(hit&&Date.now()-hit.at<5*60_000)return hit.items;
 const preset=PRESETS[key];
 const words=key.split(/\s+/).filter(w=>w.length>2&&!['news','immigration','the','and'].includes(w));
 const [gov,media]=await Promise.all([
  settled(OFFICIAL.filter(f=>!preset||preset.official.includes(f.region)).map(official)),
  settled((preset?preset.queries:[topic]).map(bing))
 ]);
 let found=media;
 if(found.length<10)found=found.concat(await settled([google(preset?'immigration':topic)]));
 // Presets drop off-topic hits (e.g. Visa the card company); free-text searches keep what was asked for.
 if(preset)found=found.filter(relevant);
 const govMatches=preset?gov:gov.filter(x=>words.length?words.some(w=>`${x.title} ${x.summary}`.toLowerCase().includes(w)):relevant(x));
 const now=Date.now();
 const recent=(x:NewsItem,days:number)=>!x.published_at||now-Date.parse(x.published_at)<days*DAY;
 const seen=new Set<string>();
 const unique=[...govMatches.filter(x=>recent(x,45)),...found.filter(x=>recent(x,7))]
  .filter(x=>x.title.length>=8)
  .sort((a,b)=>RANK[a.trust]-RANK[b.trust]) // keep the most trusted copy of a duplicate story
  .filter(x=>{const k=x.title.toLowerCase().replace(/\W+/g,' ').trim().slice(0,70);if(seen.has(k)||seen.has(x.url))return false;seen.add(k);seen.add(x.url);return true})
  .sort((a,b)=>(b.published_at||'').localeCompare(a.published_at||''));
 // Official notices are rarer and older than media stories, so they get their own share of the list.
 const result=[...unique.filter(x=>x.trust==='official').slice(0,40),...unique.filter(x=>x.trust!=='official').slice(0,100)]
  .sort((a,b)=>(b.published_at||'').localeCompare(a.published_at||''));
 if(result.length)cache.set(key,{at:now,items:result});
 return result;
}

function publicHost(url:URL){
 const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
 if(url.protocol!=='https:'||url.port||url.username||url.password)return false;
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||!host.includes('.'))return false;
 if(isIP(host)===6)return false;
 if(isIP(host)===4){const [a,b]=host.split('.').map(Number);if(a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127))return false}
 return true;
}

// Best-effort article reader: returns readable paragraph text, or '' if the page cannot be read.
export async function readArticle(raw:string):Promise<string>{
 try{
  const url=new URL(raw);if(!publicHost(url)||url.hostname.endsWith('news.google.com'))return '';
  const r=await fetch(url,{headers:{'user-agent':UA,accept:'text/html'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok||!(r.headers.get('content-type')||'').includes('html')||!r.body)return '';
  const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(size<3_000_000){const {done,value}=await reader.read();if(done)break;chunks.push(value);size+=value.length}
  reader.cancel().catch(()=>{});
  const html=Buffer.concat(chunks).toString('utf8').replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi,' ');
  const description=html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const paragraphs=[...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>plain(m[1])).filter(p=>p.length>=60);
  const text=[description?decodeEntities(description):'',...paragraphs].filter(Boolean).join('\n');
  return text.slice(0,8000);
 }catch{return ''}
}
