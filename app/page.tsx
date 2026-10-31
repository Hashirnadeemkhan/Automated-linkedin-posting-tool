'use client';
import {useEffect,useRef,useState} from 'react';
import {createClient, type Session} from '@supabase/supabase-js';

type Article={id:string;title:string;url:string;summary:string|null;source:string|null;published_at:string|null};
type Version={version:number;body:string;image_url:string|null;image_preview:string|null;created_at:string};
type Event={version:number;action:string;feedback:string|null;created_at:string};
type Draft={id:string;article_id:string;status:string;current_version:number;approved_version:number|null;linkedin_post_id:string|null;created_at:string;draft_versions:Version[];review_events:Event[]};
type Config={gemini:boolean;linkedin:boolean;publishing:boolean;images:boolean};
type Data={articles:Article[];drafts:Draft[];connection:{member_sub:string;expires_at:string}|null;config:Config};
type NewsItem={title:string;url:string;source:string;summary:string;published_at:string|null};
type Tab='review'|'ready'|'attention'|'published'|'closed';
type Toast={text:string;tone:'ok'|'danger'|'info'}|null;

const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const BODY_LIMIT=3000;
const TOPICS=['Immigration','H-1B','Green card','UK visa','Canada immigration'];

// Short status labels; a note is shown only when the reviewer has to do something unusual.
const STATUS:Record<string,{label:string;tone:string;note?:string}>={
 pending_review:{label:'To review',tone:'warn'},
 changes_requested:{label:'Revision pending',tone:'warn',note:'The AI rewrite did not finish. Click “Revise with AI” again.'},
 approved:{label:'Approved',tone:'ok'},
 rejected:{label:'Rejected',tone:''},
 publishing:{label:'Check LinkedIn',tone:'danger',note:'Publishing did not finish. Look on your LinkedIn profile, then choose below.'},
 published:{label:'Published',tone:'ok'},
 publish_uncertain:{label:'Check LinkedIn',tone:'danger',note:'LinkedIn did not confirm the post. Look on your LinkedIn profile, then choose below.'},
 failed:{label:'Failed',tone:'danger',note:'Nothing was posted. You can try again.'}
};
const statusOf=(s:string)=>STATUS[s]||{label:s,tone:''};
const TABS:{key:Tab;label:string;statuses:string[];hideEmpty?:boolean}[]=[
 {key:'review',label:'To review',statuses:['pending_review','changes_requested']},
 {key:'ready',label:'Ready to post',statuses:['approved']},
 {key:'attention',label:'Needs check',statuses:['publishing','publish_uncertain','failed'],hideEmpty:true},
 {key:'published',label:'Published',statuses:['published']},
 {key:'closed',label:'Rejected',statuses:['rejected'],hideEmpty:true}
];

function ago(iso:string|null){
 if(!iso)return '';
 const m=Math.round((Date.now()-new Date(iso).getTime())/60000);
 if(m<1)return 'just now';if(m<60)return `${m} min ago`;
 const h=Math.round(m/60);if(h<24)return `${h} h ago`;
 const d=Math.round(h/24);return d<14?`${d} day${d>1?'s':''} ago`:new Date(iso).toLocaleDateString();
}

export default function Home(){
 const [session,setSession]=useState<Session|null>(null);
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [data,setData]=useState<Data|null>(null);
 const [busy,setBusy]=useState(false),[working,setWorking]=useState('');
 const [toast,setToast]=useState<Toast>(null);
 const toastTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [edits,setEdits]=useState<Record<string,{body:string;feedback:string}>>({});
 const [tab,setTab]=useState<Tab>('review');
 const [query,setQuery]=useState('Immigration'),[news,setNews]=useState<NewsItem[]|null>(null),[newsError,setNewsError]=useState(''),[newsLoading,setNewsLoading]=useState(false);
 const [articleUrl,setArticleUrl]=useState(''),[articleTitle,setArticleTitle]=useState(''),[articleSummary,setArticleSummary]=useState('');

 function show(text:string,tone:'ok'|'danger'|'info'){
  clearTimeout(toastTimer.current);setToast({text,tone});
  if(tone==='ok')toastTimer.current=setTimeout(()=>setToast(null),4000);
 }

 useEffect(()=>{
  supabase.auth.getSession().then(({data})=>setSession(data.session));
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>setSession(s));
  const linkedin=new URLSearchParams(window.location.search).get('linkedin');
  if(linkedin){
   show(linkedin==='connected'?'LinkedIn connected.':`LinkedIn connection failed: ${linkedin}`,linkedin==='connected'?'ok':'danger');
   window.history.replaceState(null,'','/');
  }
  return()=>subscription.unsubscribe();
 },[]);

 async function api(path:string,body?:unknown){
  const isForm=body instanceof FormData;
  const r=await fetch(path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${session?.access_token}`,...(body&&!isForm?{'content-type':'application/json'}:{})},body:body?(isForm?body:JSON.stringify(body)):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||`Request failed (HTTP ${r.status})`);
  return j;
 }
 async function load(){
  if(!session)return;
  try{setData(await api('/api/dashboard'))}catch(e){show(e instanceof Error?e.message:String(e),'danger')}
 }
 async function findNews(q=query){
  setQuery(q);setNewsLoading(true);setNewsError('');
  try{const j=await api(`/api/news?q=${encodeURIComponent(q)}`);setNews(j.items)}
  catch(e){setNews([]);setNewsError(e instanceof Error?e.message:String(e))}
  finally{setNewsLoading(false)}
 }
 useEffect(()=>{if(session){load();if(!news)findNews()}else setData(null)},[session]);

 async function act(fn:()=>Promise<unknown>,success:string,pending?:string){
  setBusy(true);if(pending)show(pending,'info');else setToast(null);
  try{await fn();show(success,'ok');await load();return true}
  catch(e){show(e instanceof Error?e.message:String(e),'danger');await load();return false}
  finally{setBusy(false);setWorking('')}
 }
 function edit(d:Draft){
  const v=d.draft_versions.find(x=>x.version===d.current_version);
  return edits[d.id]||{body:v?.body||'',feedback:''};
 }
 function update(d:Draft,field:'body'|'feedback',value:string){
  setEdits(s=>({...s,[d.id]:{...edit(d),[field]:value}}));
 }
 function reset(d:Draft){setEdits(s=>{const n={...s};delete n[d.id];return n})}
 // Unsaved text edits are saved as a new version first, so Approve and Revise always act on what the reviewer sees.
 async function saveIfEdited(d:Draft,v:Version|undefined){
  const body=edit(d).body;
  if(body===(v?.body||''))return d.current_version;
  const j=await api(`/api/drafts/${d.id}/versions`,{expected_version:d.current_version,body,image_url:v?.image_url||''});
  return j.version as number;
 }

 function writePost(item:NewsItem){
  setWorking(item.url);
  act(async()=>{
   const a=await api('/api/articles',{url:item.url,title:item.title.slice(0,500),summary:item.summary||undefined,source:item.source||undefined,published_at:item.published_at});
   await api('/api/drafts',{article_id:a.article_id});
   setTab('review');
  },'Post written. Review it on the right.','The AI is reading the article and writing the post. This takes about 15 seconds…');
 }
 function uploadPicture(d:Draft,file:File){
  if(file.size>4_000_000){show('The picture must be under 4 MB.','danger');return}
  const form=new FormData();
  form.set('file',file);form.set('expected_version',String(d.current_version));form.set('body',edit(d).body);
  setWorking(`img${d.id}`);
  act(async()=>{await api(`/api/drafts/${d.id}/image`,form);reset(d)},'Picture added.','Uploading picture…');
 }

 if(!session)return (
  <main className="signin">
   <form className="signin-card" onSubmit={e=>{
    e.preventDefault();
    act(async()=>{
     const {error}=await supabase.auth.signInWithPassword({email,password});
     if(error)throw new Error(error.message==='Invalid login credentials'?'Wrong email or password.':error.message);
    },'Signed in');
   }}>
    <div className="mark big">in</div>
    <h1>Immigration News</h1>
    <p className="muted">Sign in to write and approve LinkedIn posts.</p>
    <label htmlFor="email">Email</label>
    <input id="email" type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/>
    <label htmlFor="password">Password</label>
    <input id="password" type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/>
    <button type="submit" className="primary wide" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
    {toast&&toast.tone==='danger'&&<p className="inline-error" role="alert">{toast.text}</p>}
   </form>
  </main>
 );

 const config=data?.config;
 const connected=!!data?.connection;
 const drafts=data?.drafts||[];
 const articleById=new Map((data?.articles||[]).map(a=>[a.id,a]));
 const articleByUrl=new Map((data?.articles||[]).map(a=>[a.url,a]));
 const draftCount=new Map<string,number>();
 for(const d of drafts)draftCount.set(d.article_id,(draftCount.get(d.article_id)||0)+1);
 const countFor=(t:Tab)=>drafts.filter(d=>TABS.find(x=>x.key===t)!.statuses.includes(d.status)).length;
 const shown=drafts.filter(d=>TABS.find(x=>x.key===tab)!.statuses.includes(d.status));
 const connectLinkedIn=()=>act(async()=>{const j=await api('/api/linkedin/start',{});window.location.href=j.url},'Opening LinkedIn…');

 return (
  <>
   <header className="topbar">
    <div className="topbar-inner">
     <div className="brand"><div className="mark">in</div><span>Immigration News</span></div>
     {data&&(connected
      ?<span className="chip ok" title={`Access valid until ${new Date(data.connection!.expires_at).toLocaleDateString()}`}>● LinkedIn connected</span>
      :<button className="primary small" disabled={busy||!config?.linkedin} onClick={connectLinkedIn}>Connect LinkedIn</button>)}
     <button className="ghost small" title={session.user.email} onClick={()=>supabase.auth.signOut()}>Sign out</button>
    </div>
   </header>

   <main className="shell">
    {config&&(!config.gemini||!config.linkedin)&&(
     <p className="notice danger">Setup is incomplete: {[!config.gemini&&'AI writing (GEMINI_API_KEY)',!config.linkedin&&'LinkedIn app keys'].filter(Boolean).join(' and ')} not configured. Ask the admin.</p>
    )}
    {data&&config?.linkedin&&!connected&&(
     <p className="notice warn">Connect your LinkedIn account once so approved posts can be published to your profile.
      <button className="primary small" disabled={busy} onClick={connectLinkedIn}>Connect LinkedIn</button></p>
    )}

    <div className="cols">
     {/* ---------- News ---------- */}
     <section className="panel">
      <div className="panel-head"><h2><span className="num">1</span>Pick a story</h2></div>
      <form className="searchbar" onSubmit={e=>{e.preventDefault();if(query.trim())findNews()}}>
       <input aria-label="Search news" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search a topic, e.g. H-1B"/>
       <button className="primary" disabled={newsLoading||!query.trim()}>{newsLoading?'…':'Search'}</button>
      </form>
      <div className="topics">
       {TOPICS.map(t=><button key={t} type="button" className={`topic ${query===t?'on':''}`} disabled={newsLoading} onClick={()=>findNews(t)}>{t}</button>)}
      </div>

      {newsLoading&&<div className="empty">Loading the latest headlines…</div>}
      {!newsLoading&&newsError&&<div className="empty">{newsError}</div>}
      {!newsLoading&&news?.length===0&&!newsError&&<div className="empty">No news found. Try another topic.</div>}

      {!newsLoading&&news&&news.length>0&&(
       <ul className="news">
        {news.map(item=>{
         const saved=articleByUrl.get(item.url);
         const made=saved?draftCount.get(saved.id)||0:0;
         return (
          <li key={item.url}>
           <div className="news-text">
            <a className="news-title" href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
            <p className="meta">{item.source||'News'}{item.published_at&&<> · {ago(item.published_at)}</>}{made>0&&<span className="chip ok tiny">written</span>}</p>
            {item.summary&&<p className="news-summary">{item.summary}</p>}
           </div>
           <button className={made>0?'ghost small':'primary small'} disabled={busy||!config?.gemini} onClick={()=>writePost(item)}>
            {working===item.url?'Writing…':made>0?'Write again':'Write post'}
           </button>
          </li>
         );
        })}
       </ul>
      )}

      <details className="manual">
       <summary>Use my own article link</summary>
       <form onSubmit={e=>{
        e.preventDefault();
        act(async()=>{
         const a=await api('/api/articles',{url:articleUrl,title:articleTitle,summary:articleSummary||undefined});
         await api('/api/drafts',{article_id:a.article_id});
         setArticleUrl('');setArticleTitle('');setArticleSummary('');setTab('review');
        },'Post written. Review it on the right.','The AI is writing the post. This takes about 15 seconds…');
       }}>
        <input type="url" required aria-label="Article link" value={articleUrl} onChange={e=>setArticleUrl(e.target.value)} placeholder="Article link (https://…)"/>
        <input required minLength={8} aria-label="Headline" value={articleTitle} onChange={e=>setArticleTitle(e.target.value)} placeholder="Headline"/>
        <textarea aria-label="Extra facts" value={articleSummary} onChange={e=>setArticleSummary(e.target.value)} rows={3} placeholder="Key facts (optional, useful if the site is paywalled)"/>
        <button className="primary" disabled={busy||!config?.gemini}>Write post</button>
       </form>
      </details>
     </section>

     {/* ---------- Posts ---------- */}
     <section className="panel">
      <div className="panel-head"><h2><span className="num">2</span>Review &amp; post</h2></div>
      <div className="tabs" role="tablist">
       {TABS.filter(t=>!t.hideEmpty||countFor(t.key)>0||tab===t.key).map(t=>{const n=countFor(t.key);return (
        <button key={t.key} role="tab" aria-selected={tab===t.key} className={`tab ${tab===t.key?'active':''}`} onClick={()=>setTab(t.key)}>
         {t.label}{n>0&&<span className={`count ${t.key==='attention'?'danger':''}`}>{n}</span>}
        </button>
       )})}
      </div>

      {shown.length===0&&(
       <div className="empty">
        {tab==='review'?'Nothing to review. Click “Write post” on a story.'
         :tab==='ready'?'No approved posts yet.'
         :tab==='published'?'Nothing published yet.'
         :'Nothing here.'}
       </div>
      )}

      {shown.map(d=>{
       const v=d.draft_versions.find(x=>x.version===d.current_version);
       const x=edit(d);
       const meta=statusOf(d.status);
       const article=articleById.get(d.article_id);
       const unsaved=x.body!==(v?.body||'');
       const canEdit=d.status==='pending_review'||d.status==='changes_requested';
       const over=x.body.length>BODY_LIMIT;
       const tooShort=x.body.trim().length<10;
       return (
        <article className="post" key={d.id}>
         <div className="post-head">
          <div className="post-title">
           {article?<a href={article.url} target="_blank" rel="noreferrer" title="Open the source article">{article.title} ↗</a>:'Story removed'}
           <span className="meta">Version {d.current_version} · {ago(v?.created_at||d.created_at)}</span>
          </div>
          <span className={`chip ${meta.tone}`}>{meta.label}</span>
         </div>
         {meta.note&&<p className={`notice ${meta.tone||'info'}`}>{meta.note}</p>}

         {canEdit?(
          <>
           <textarea className="post-body" aria-label="Post text" value={x.body} onChange={e=>update(d,'body',e.target.value)} rows={12}/>
           <div className="under-body">
            {unsaved?<button className="link" disabled={busy} onClick={()=>reset(d)}>Undo my edits</button>:<span className="muted">You can edit the text directly.</span>}
            <span className={`counter ${over?'over':''}`}>{x.body.length}/{BODY_LIMIT}</span>
           </div>

           <div className="picture">
            {v?.image_preview&&<img src={v.image_preview} alt="Post picture"/>}
            <div className="picture-actions">
             <label className={`file-btn ${busy?'disabled':''}`}>
              {working===`img${d.id}`?'Uploading…':v?.image_url?'Change picture':'+ Add picture'}
              <input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)uploadPicture(d,f)}}/>
             </label>
             {v?.image_url&&<button className="link" disabled={busy}
              onClick={()=>act(async()=>{await api(`/api/drafts/${d.id}/versions`,{expected_version:d.current_version,body:x.body,image_url:''});reset(d)},'Picture removed.')}>Remove</button>}
             {!v?.image_url&&<span className="muted">JPEG or PNG, under 4 MB</span>}
            </div>
           </div>

           <form className="revise" onSubmit={e=>{
            e.preventDefault();
            setWorking(`rev${d.id}`);
            act(async()=>{const version=await saveIfEdited(d,v);await api(`/api/drafts/${d.id}/revise`,{version,feedback:x.feedback.trim()});reset(d)},
             'The AI updated the post.','The AI is rewriting the post…');
           }}>
            <input aria-label="What should the AI change?" value={x.feedback} onChange={e=>update(d,'feedback',e.target.value)}
             placeholder="Tell the AI what to change, e.g. “make it shorter”"/>
            <button className="ghost" disabled={busy||x.feedback.trim().length<3||over||tooShort}>
             {working===`rev${d.id}`?'Rewriting…':'Revise with AI'}
            </button>
           </form>

           <div className="decision">
            <button className="primary" disabled={busy||over||tooShort||(d.status!=='pending_review'&&!unsaved)}
             onClick={()=>act(async()=>{const version=await saveIfEdited(d,v);await api(`/api/drafts/${d.id}/review`,{action:'approve',version});reset(d)},'Approved. Now publish it from “Ready to post”.').then(ok=>{if(ok)setTab('ready')})}>
             ✓ {unsaved?'Save & approve':'Approve'}
            </button>
            <button className="ghost danger" disabled={busy||d.status!=='pending_review'}
             onClick={()=>{if(confirm('Reject this post? It will not be published.'))act(()=>api(`/api/drafts/${d.id}/review`,{action:'reject',version:d.current_version}),'Rejected.')}}>
             Reject
            </button>
           </div>
          </>
         ):(
          <>
           {v&&<p className="post-preview">{v.body}</p>}
           {v?.image_preview&&<img className="post-image" src={v.image_preview} alt="Post picture"/>}
          </>
         )}

         {d.status==='approved'&&(
          <div className="decision">
           {connected
            ?<button className="primary" disabled={busy||!config?.publishing}
              onClick={()=>{if(confirm('Post this on LinkedIn now?'))act(()=>api(`/api/drafts/${d.id}/publish`,{}),'Published to LinkedIn.','Publishing…').then(ok=>{if(ok)setTab('published')})}}>
              Publish to LinkedIn
             </button>
            :<button className="primary" disabled={busy||!config?.linkedin} onClick={connectLinkedIn}>Connect LinkedIn first</button>}
           {!config?.publishing&&<span className="muted">Publishing is switched off. Ask the admin to turn it on.</span>}
          </div>
         )}

         {['publishing','publish_uncertain','failed'].includes(d.status)&&(
          <div className="decision">
           <button className="ghost" disabled={busy}
            onClick={()=>{if(confirm('Is the post visible on your LinkedIn profile?'))act(()=>api(`/api/drafts/${d.id}/reconcile`,{outcome:'posted'}),'Marked as published.')}}>
            It is on LinkedIn
           </button>
           <button className="ghost" disabled={busy}
            onClick={()=>{if(confirm('Confirm the post is NOT on LinkedIn. It goes back to “Ready to post”.'))act(()=>api(`/api/drafts/${d.id}/reconcile`,{outcome:'not_posted'}),'Moved back to Ready to post.')}}>
            It is not there, try again
           </button>
          </div>
         )}

         {d.status==='published'&&d.linkedin_post_id&&(
          <a className="view-link" href={`https://www.linkedin.com/feed/update/${d.linkedin_post_id}/`} target="_blank" rel="noreferrer">View on LinkedIn ↗</a>
         )}

         {d.draft_versions.length>1&&(
          <details className="history">
           <summary>Earlier versions ({d.draft_versions.length-1})</summary>
           {[...d.draft_versions].filter(ver=>ver.version!==d.current_version).sort((a,b)=>b.version-a.version).map(ver=>{
            const fb=d.review_events.find(e=>e.version===ver.version&&e.action==='request_changes');
            return (
             <div className="history-item" key={ver.version}>
              <p className="meta">Version {ver.version} · {new Date(ver.created_at).toLocaleString()}</p>
              {fb?.feedback&&<p className="feedback">You asked: “{fb.feedback}”</p>}
              <p className="post-preview small">{ver.body}</p>
             </div>
            );
           })}
          </details>
         )}
        </article>
       );
      })}
     </section>
    </div>
   </main>

   {toast&&(
    <div className={`toast ${toast.tone}`} role="status">
     <span>{toast.text}</span>
     <button className="toast-close" aria-label="Close" onClick={()=>setToast(null)}>×</button>
    </div>
   )}
  </>
 );
}
