import {isIP} from 'node:net';

export type NewsItem={title:string;url:string;source:string;summary:string;published_at:string|null};

const UA='Mozilla/5.0 (compatible; ImmigrationNewsReview/1.0)';

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
 const r=await fetch(url,{headers:{'user-agent':UA},cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error(`Feed returned ${r.status}`);
 return r.text();
}

// Bing News RSS links wrap the publisher URL in a click-tracking redirect; unwrap it.
async function bing(query:string):Promise<NewsItem[]>{
 const xml=await getText(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&count=30&qft=${encodeURIComponent('sortbydate="1"')}`);
 return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([,item])=>{
  let url=tag(item,'link');
  try{const u=new URL(url);if(u.hostname.endsWith('bing.com')&&u.searchParams.get('url'))url=u.searchParams.get('url')!}catch{return []}
  if(!url.startsWith('https://'))return [];
  return [{title:plain(tag(item,'title')),url,source:plain(tag(item,'News:Source')),summary:plain(tag(item,'description')),published_at:isoDate(tag(item,'pubDate'))}];
 });
}

// Google News RSS is the fallback. Its links open via news.google.com, so article text cannot be read.
async function google(query:string):Promise<NewsItem[]>{
 const xml=await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(query+' when:3d')}&hl=en-US&gl=US&ceid=US:en`);
 return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([,item])=>{
  const source=plain(tag(item,'source'));let title=plain(tag(item,'title'));
  if(source&&title.endsWith(` - ${source}`))title=title.slice(0,-(source.length+3));
  return {title,url:tag(item,'link'),source,summary:'',published_at:isoDate(tag(item,'pubDate'))};
 }).filter(x=>x.url.startsWith('https://'));
}

export async function searchNews(query:string):Promise<NewsItem[]>{
 let items:NewsItem[]=[];
 try{items=await bing(query)}catch{}
 if(items.length<5){try{items=items.concat(await google(query))}catch{}}
 const seen=new Set<string>();
 return items
  .filter(x=>x.title.length>=8)
  .filter(x=>{const k=x.title.toLowerCase().replace(/\W+/g,' ').trim();if(seen.has(k)||seen.has(x.url))return false;seen.add(k);seen.add(x.url);return true})
  .sort((a,b)=>(b.published_at||'').localeCompare(a.published_at||''))
  .slice(0,30);
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
