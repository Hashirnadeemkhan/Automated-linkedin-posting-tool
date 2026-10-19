'use client';
import {useEffect,useState} from 'react';
import {createClient, type Session} from '@supabase/supabase-js';

type Article={id:string;title:string;url:string;summary:string|null;source:string|null;published_at:string|null};
type Version={version:number;body:string;image_url:string|null;image_preview:string|null;created_at:string};
type Event={version:number;action:string;feedback:string|null;created_at:string};
type Draft={id:string;article_id:string;status:string;current_version:number;approved_version:number|null;linkedin_post_id:string|null;created_at:string;draft_versions:Version[];review_events:Event[]};
type Config={gemini:boolean;linkedin:boolean;publishing:boolean;images:boolean};
type Data={articles:Article[];drafts:Draft[];connection:{member_sub:string;expires_at:string}|null;config:Config};
type NewsItem={title:string;url:string;source:string;summary:string;published_at:string|null};
type Tab='review'|'ready'|'attention'|'published'|'closed';

const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const BODY_LIMIT=3000;

// Every draft status, in plain words, with what the reviewer should do about it.
const STATUS:Record<string,{label:string;tone:string;note:string}>={
 pending_review:{label:'Needs your review',tone:'warn',note:'Read the post and check it against the source. Approve it, or tell the AI what to change.'},
 changes_requested:{label:'Revision pending',tone:'warn',note:'Feedback was saved but the AI rewrite did not finish. Click “Revise with AI” to try again.'},
 approved:{label:'Approved',tone:'ok',note:'This version is locked and ready. Nothing has been posted to LinkedIn yet.'},
 rejected:{label:'Rejected',tone:'',note:'This draft will not be posted.'},
 publishing:{label:'Stuck while publishing',tone:'danger',note:'A publish attempt started but never finished. Open LinkedIn and check whether the post exists.'},
 published:{label:'Published',tone:'ok',note:'This post is live on LinkedIn.'},
 publish_uncertain:{label:'Needs a manual check',tone:'danger',note:'LinkedIn did not confirm the post. Open LinkedIn and check before you retry — it may already be there.'},
 failed:{label:'Failed',tone:'danger',note:'Publishing failed before anything was sent to LinkedIn. It is safe to try again.'}
};
const statusOf=(s:string)=>STATUS[s]||{label:s,tone:'',note:''};
const TABS:{key:Tab;label:string;statuses:string[]}[]=[
 {key:'review',label:'To review',statuses:['pending_review','changes_requested']},
 {key:'ready',label:'Ready to publish',statuses:['approved']},
 {key:'attention',label:'Needs attention',statuses:['publishing','publish_uncertain','failed']},
 {key:'published',label:'Published',statuses:['published']},
 {key:'closed',label:'Rejected',statuses:['rejected']}
];

const STEPS=[
 {title:'Find the news',text:'Today’s immigration headlines load on the left. Search any topic.'},
 {title:'Pick a story',text:'Click “Write post”. The AI reads the article and drafts a short, objective post.'},
 {title:'Review',text:'Edit, add a picture, or tell the AI what to change. Repeat until it is right.'},
 {title:'Approve & publish',text:'Approve the final version, then post it to LinkedIn with one click.'}
];

function ago(iso:string|null){
 if(!iso)return '';
 const m=Math.round((Date.now()-new Date(iso).getTime())/60000);
 if(m<1)return 'just now';if(m<60)return `${m} min ago`;
 const h=Math.round(m/60);if(h<24)return `${h} hour${h>1?'s':''} ago`;
 const d=Math.round(h/24);return d<14?`${d} day${d>1?'s':''} ago`:new Date(iso).toLocaleDateString();
}

export default function Home(){
 const [session,setSession]=useState<Session|null>(null);
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [data,setData]=useState<Data|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 const [working,setWorking]=useState('');
 const [edits,setEdits]=useState<Record<string,{body:string;feedback:string}>>({});
 const [tab,setTab]=useState<Tab>('review');
 const [query,setQuery]=useState('immigration'),[news,setNews]=useState<NewsItem[]|null>(null),[newsError,setNewsError]=useState(''),[newsLoading,setNewsLoading]=useState(false);
 const [articleUrl,setArticleUrl]=useState(''),[articleTitle,setArticleTitle]=useState('');
 const [articleSummary,setArticleSummary]=useState(''),[articleSource,setArticleSource]=useState('');

 useEffect(()=>{
  supabase.auth.getSession().then(({data})=>setSession(data.session));
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>setSession(s));
  const linkedin=new URLSearchParams(window.location.search).get('linkedin');
  if(linkedin){
   setFailed(linkedin!=='connected');
   setMessage(linkedin==='connected'?'LinkedIn account connected.':`LinkedIn connection failed: ${linkedin}`);
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
  try{setData(await api('/api/dashboard'))}catch(e){setFailed(true);setMessage(e instanceof Error?e.message:String(e))}
 }
 async function findNews(q=query){
  setNewsLoading(true);setNewsError('');
  try{const j=await api(`/api/news?q=${encodeURIComponent(q)}`);setNews(j.items)}
  catch(e){setNews([]);setNewsError(e instanceof Error?e.message:String(e))}
  finally{setNewsLoading(false)}
 }
 useEffect(()=>{if(session){load();if(!news)findNews()}else setData(null)},[session]);

 async function act(fn:()=>Promise<unknown>,success:string){
  setBusy(true);setMessage('');
  try{await fn();setFailed(false);setMessage(success);await load();return true}
  catch(e){setFailed(true);setMessage(e instanceof Error?e.message:String(e));await load();return false}
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

 function writePost(item:NewsItem){
  setWorking(item.url);
  act(async()=>{
   const a=await api('/api/articles',{url:item.url,title:item.title.slice(0,500),summary:item.summary||undefined,source:item.source||undefined,published_at:item.published_at});
   await api('/api/drafts',{article_id:a.article_id});
   setTab('review');
  },'Draft written. Review it in the “To review” tab.');
 }
 function uploadPicture(d:Draft,file:File){
  if(file.size>4_000_000){setFailed(true);setMessage('The picture must be under 4 MB.');return}
  const form=new FormData();
  form.set('file',file);form.set('expected_version',String(d.current_version));form.set('body',edit(d).body);
  setWorking(`img${d.id}`);
  act(async()=>{await api(`/api/drafts/${d.id}/image`,form);reset(d)},'Picture added as a new version.');
 }

 if(!session)return (
  <main className="signin">
   <div className="signin-card">
    <div className="signin-head">
     <div className="mark">IN</div>
     <h1>Immigration News Review</h1>
     <p>Find today’s immigration news, let AI draft a LinkedIn post, review it, and publish. Nothing is posted without your approval.</p>
    </div>
    <form className="card" onSubmit={e=>{
     e.preventDefault();
     act(async()=>{
      const {error}=await supabase.auth.signInWithPassword({email,password});
      if(error)throw new Error(error.message==='Invalid login credentials'
       ?'Wrong email or password. Ask the admin to reset it with: node scripts/provision-reviewer.mjs your@email.com'
       :error.message);
     },'Signed in');
    }}>
     <div className="field">
      <label htmlFor="email">Email</label>
      <span className="hint">Your reviewer account for this dashboard. This is not your LinkedIn login.</span>
      <input id="email" type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
     </div>
     <div className="field">
      <label htmlFor="password">Password</label>
      <input id="password" type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/>
     </div>
     <button type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
     {message&&<p className={`banner ${failed?'danger':'ok'}`} style={{marginTop:14}} role="status">{message}</p>}
    </form>
   </div>
  </main>
 );

 const config=data?.config;
 const drafts=data?.drafts||[];
 const articleById=new Map((data?.articles||[]).map(a=>[a.id,a]));
 const articleByUrl=new Map((data?.articles||[]).map(a=>[a.url,a]));
 const draftCount=new Map<string,number>();
 for(const d of drafts)draftCount.set(d.article_id,(draftCount.get(d.article_id)||0)+1);
 const countFor=(t:Tab)=>drafts.filter(d=>TABS.find(x=>x.key===t)!.statuses.includes(d.status)).length;
 const shown=drafts.filter(d=>TABS.find(x=>x.key===tab)!.statuses.includes(d.status));
 const setupDone=config&&config.gemini&&config.linkedin&&data?.connection&&config.publishing;

 return (
  <>
   <header className="topbar">
    <div className="topbar-inner">
     <div className="brand">
      <div className="mark">IN</div>
      <div>
       <h1>Immigration News Review</h1>
       <small>{session.user.email}</small>
      </div>
     </div>
     {countFor('review')>0&&<button className="pill warn as-pill" onClick={()=>setTab('review')}>{countFor('review')} to review</button>}
     <span className={`pill ${data?.connection?'ok':''}`}>{data?.connection?'LinkedIn connected':'LinkedIn not connected'}</span>
     <button className="secondary" onClick={()=>supabase.auth.signOut()}>Sign out</button>
    </div>
   </header>

   <main className="shell">
    {message&&<p className={`banner ${failed?'danger':'ok'}`} role="status">{message}</p>}

    <div className="steps">
     {STEPS.map((s,i)=>(
      <div className="step" key={s.title}>
       <b>{i+1}</b>
       <div><strong>{s.title}</strong><p>{s.text}</p></div>
      </div>
     ))}
    </div>

    {config&&!setupDone&&(
     <section className="card">
      <div className="card-head"><h2>Setup</h2></div>
      <p className="sub">What is ready and what is still missing. Items marked <code>.env.local</code> need a server restart after you change them.</p>
      <ul className="checklist">
       <Check on={config.gemini} label="AI post writing (Gemini)" todo="Set GEMINI_API_KEY in .env.local."/>
       <Check on={config.linkedin} label="LinkedIn app credentials" todo="Set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET and LINKEDIN_REDIRECT_URI in .env.local."/>
       <Check on={!!data?.connection} label="Your LinkedIn account connected" todo="Use the Connect LinkedIn button below. Posts go to the account you connect."/>
       <Check on={config.publishing} label="Publishing switched on" todo="Set PUBLISH_ENABLED=true in .env.local when you are ready to post for real."/>
      </ul>
     </section>
    )}

    <section className="card">
     <div className="card-head">
      <h2>LinkedIn account</h2>
      <span className={`pill ${data?.connection?'ok':'warn'}`}>{data?.connection?'Connected':'Not connected'}</span>
     </div>
     <p className="sub">
      Approved posts are published to <b>your</b> personal LinkedIn profile — the account you sign in with when you click Connect.
      Each reviewer connects their own account.
     </p>
     {data?.connection
      ?<p className="meta">Member ID {data.connection.member_sub}<span className="dot"/>Access valid until {new Date(data.connection.expires_at).toLocaleDateString()}</p>
      :<p className="meta">Not connected yet, so nothing can be published.</p>}
     <div className="actions">
      <button className={data?.connection?'secondary':''} disabled={busy||!config?.linkedin}
       title={!config?.linkedin?'Add the LinkedIn client ID and secret first':''}
       onClick={()=>act(async()=>{const j=await api('/api/linkedin/start',{});window.location.href=j.url},'Opening LinkedIn…')}>
       {data?.connection?'Reconnect LinkedIn':'Connect LinkedIn'}
      </button>
      <p className="why">Sign in to LinkedIn in this same browser first (Google sign-in works), then click Connect and press Allow. Reconnect about every two months when access expires.</p>
     </div>
    </section>

    <div className="cols">
     {/* ---------- 1. Find news ---------- */}
     <div className="stack">
      <div className="section-title"><h2>1 · Today’s news</h2><span>pick the most engaging story</span></div>

      <form className="card" onSubmit={e=>{e.preventDefault();findNews()}}>
       <label htmlFor="q">Topic</label>
       <span className="hint">Latest headlines are fetched from news sites, newest first. Try “H-1B”, “UK visa”, “Canada express entry” or “green card”.</span>
       <div className="searchbar">
        <input id="q" value={query} onChange={e=>setQuery(e.target.value)} placeholder="immigration"/>
        <button disabled={newsLoading||!query.trim()}>{newsLoading?'Searching…':'Find news'}</button>
       </div>
      </form>

      {newsLoading&&!news&&<div className="empty">Loading today’s headlines…</div>}
      {newsError&&<p className="banner danger">{newsError}</p>}
      {news?.length===0&&!newsError&&<div className="empty"><strong>No results</strong>Try a broader topic.</div>}

      {news&&news.length>0&&(
       <div className="card news-list">
        {news.map(item=>{
         const saved=articleByUrl.get(item.url);
         const made=saved?draftCount.get(saved.id)||0:0;
         return (
          <article className="news-item" key={item.url}>
           <h3><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></h3>
           <p className="meta">{item.source||'Unknown source'}{item.published_at&&<><span className="dot"/>{ago(item.published_at)}</>}{made>0&&<span className="pill ok">post written</span>}</p>
           {item.summary&&<p className="summary">{item.summary}</p>}
           <div className="actions tight">
            <button className={made>0?'secondary':''} disabled={busy||!config?.gemini}
             title={!config?.gemini?'Set GEMINI_API_KEY first':''} onClick={()=>writePost(item)}>
             {working===item.url?'AI is writing…':made>0?'Write another version':'Write post'}
            </button>
            <a className="small-link" href={item.url} target="_blank" rel="noreferrer">Read article ↗</a>
           </div>
          </article>
         );
        })}
       </div>
      )}

      <details className="card manual">
       <summary>Have a specific article? Add it manually</summary>
       <form style={{marginTop:14}} onSubmit={e=>{
        e.preventDefault();
        act(async()=>{
         const a=await api('/api/articles',{url:articleUrl,title:articleTitle,summary:articleSummary||undefined,source:articleSource||undefined});
         await api('/api/drafts',{article_id:a.article_id});
         setArticleUrl('');setArticleTitle('');setArticleSummary('');setArticleSource('');setTab('review');
        },'Draft written. Review it in the “To review” tab.');
       }}>
        <div className="field">
         <label htmlFor="url">Article link <span className="pill">required</span></label>
         <span className="hint">The full web address of the news article, starting with https://. The AI reads this page.</span>
         <input id="url" type="url" required value={articleUrl} onChange={e=>setArticleUrl(e.target.value)} placeholder="https://www.uscis.gov/newsroom/..."/>
        </div>
        <div className="field">
         <label htmlFor="title">Headline <span className="pill">required</span></label>
         <span className="hint">The article’s title, at least 8 characters.</span>
         <input id="title" required minLength={8} value={articleTitle} onChange={e=>setArticleTitle(e.target.value)} placeholder="USCIS raises H-1B registration fee for 2027"/>
        </div>
        <div className="field">
         <label htmlFor="source">Publisher</label>
         <span className="hint">Who published it. Optional.</span>
         <input id="source" value={articleSource} onChange={e=>setArticleSource(e.target.value)} placeholder="USCIS"/>
        </div>
        <div className="field">
         <label htmlFor="summary">Extra facts</label>
         <span className="hint">Optional. Anything the AI must include, or facts from a page it cannot open (paywalled sites).</span>
         <textarea id="summary" value={articleSummary} onChange={e=>setArticleSummary(e.target.value)} style={{minHeight:80}} placeholder="Effective 1 March 2027. Fee rises from $215 to $280."/>
        </div>
        <div className="actions"><button disabled={busy||!config?.gemini}>{busy?'Working…':'Add and write post'}</button></div>
       </form>
      </details>
     </div>

     {/* ---------- 2. Review & publish ---------- */}
     <div className="stack">
      <div className="section-title"><h2>2 · Review &amp; publish</h2><span>{drafts.length} draft{drafts.length===1?'':'s'}</span></div>

      <div className="tabs" role="tablist">
       {TABS.map(t=>{const n=countFor(t.key);return (
        <button key={t.key} role="tab" aria-selected={tab===t.key} className={`tab ${tab===t.key?'active':''}`} onClick={()=>setTab(t.key)}>
         {t.label}{n>0&&<span className={`count ${t.key==='attention'?'danger':''}`}>{n}</span>}
        </button>
       )})}
      </div>

      {shown.length===0&&(
       <div className="empty">
        {tab==='review'?<><strong>Nothing to review</strong>Pick a story on the left and click “Write post”. The draft will appear here.</>
         :tab==='ready'?<><strong>No approved posts</strong>Approve a draft in “To review” and it will wait here until you publish it.</>
         :tab==='attention'?<><strong>All clear</strong>Posts with publishing problems would show up here.</>
         :tab==='published'?<><strong>Nothing published yet</strong>Posts you publish to LinkedIn are listed here.</>
         :<><strong>No rejected drafts</strong></>}
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
       const revisions=d.review_events.filter(e=>e.action==='request_changes').length;
       return (
        <article className="card" key={d.id}>
         <div className="card-head">
          <h3>{article?.title||'Story removed'}</h3>
          <span className={`pill ${meta.tone}`}>{meta.label}</span>
         </div>
         <p className="meta">
          Version {d.current_version}{revisions>0&&<> · revised by AI {revisions}×</>}
          <span className="dot"/>{ago(v?.created_at||d.created_at)}
          {article&&<><span className="dot"/><a href={article.url} target="_blank" rel="noreferrer">Check the source ↗</a></>}
         </p>
         <p className={`banner ${meta.tone||'info'}`} style={{marginTop:12}}>{meta.note}</p>

         {/* picture */}
         {(v?.image_preview||canEdit)&&(
          <div className="picture">
           {v?.image_preview
            ?<img src={v.image_preview} alt="Picture attached to this post"/>
            :<div className="picture-empty">No picture</div>}
           {canEdit&&(
            <div className="picture-actions">
             <label className={`file-btn ${busy?'disabled':''}`}>
              {working===`img${d.id}`?'Uploading…':v?.image_url?'Change picture':'Add picture'}
              <input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)uploadPicture(d,f)}}/>
             </label>
             {v?.image_url&&<button className="link" disabled={busy}
              onClick={()=>act(async()=>{await api(`/api/drafts/${d.id}/versions`,{expected_version:d.current_version,body:x.body,image_url:''});reset(d)},'Picture removed.')}>Remove</button>}
             <span className="hint" style={{margin:0}}>JPEG or PNG from your computer, under 4 MB. Only use pictures you have the right to post.</span>
            </div>
           )}
          </div>
         )}

         {!canEdit&&v&&<p className="preview" style={{marginTop:12}}>{v.body}</p>}

         {d.status==='published'&&d.linkedin_post_id&&(
          <p style={{marginTop:10}}><a href={`https://www.linkedin.com/feed/update/${d.linkedin_post_id}/`} target="_blank" rel="noreferrer">View the post on LinkedIn ↗</a></p>
         )}

         {canEdit&&(
          <>
           <div className="field" style={{marginTop:14}}>
            <label>Post text</label>
            <span className="hint">Exactly what will appear on LinkedIn. You can edit it yourself — every claim should match the source.</span>
            <textarea value={x.body} onChange={e=>update(d,'body',e.target.value)} style={{minHeight:180}}/>
            <span className={`counter ${over?'over':''}`}>{x.body.length} / {BODY_LIMIT} characters</span>
           </div>
           {unsaved&&(
            <div className="actions tight">
             <button className="secondary" disabled={busy||x.body.trim().length<10||over}
              onClick={()=>act(async()=>{await api(`/api/drafts/${d.id}/versions`,{expected_version:d.current_version,body:x.body,image_url:v?.image_url||''});reset(d)},'Your edits were saved as a new version.')}>
              Save my edits
             </button>
             <button className="link" disabled={busy} onClick={()=>reset(d)}>Discard edits</button>
             <p className="why">Save your edits before approving or asking the AI to revise.</p>
            </div>
           )}

           <div className="revise">
            <label>Ask the AI to change it</label>
            <span className="hint">Describe what to change in plain words. The AI rewrites the post and it comes back here for review.</span>
            <textarea value={x.feedback} onChange={e=>update(d,'feedback',e.target.value)} style={{minHeight:70}}
             placeholder="e.g. Make it shorter. Lead with the deadline. Mention who is affected. More formal tone."/>
            <div className="actions tight">
             <button className="secondary" disabled={busy||unsaved||x.feedback.trim().length<3}
              title={unsaved?'Save or discard your edits first':!x.feedback.trim()?'Write what to change first':''}
              onClick={()=>{setWorking(`rev${d.id}`);act(async()=>{await api(`/api/drafts/${d.id}/revise`,{version:d.current_version,feedback:x.feedback.trim()});reset(d)},'The AI revised the post. Review the new version.')}}>
              {working===`rev${d.id}`?'AI is revising…':'Revise with AI'}
             </button>
            </div>
           </div>

           <div className="decision">
            <button disabled={busy||unsaved||d.status!=='pending_review'}
             title={unsaved?'Save your edits first':d.status!=='pending_review'?'Finish the revision first':''}
             onClick={()=>act(()=>api(`/api/drafts/${d.id}/review`,{action:'approve',version:d.current_version}),'Approved. Find it in “Ready to publish”.').then(ok=>{if(ok)setTab('ready')})}>
             Approve this version
            </button>
            <button className="danger" disabled={busy||d.status!=='pending_review'}
             onClick={()=>{if(confirm('Reject this draft? It will not be posted.'))act(()=>api(`/api/drafts/${d.id}/review`,{action:'reject',version:d.current_version,feedback:x.feedback||undefined}),'Rejected.')}}>
             Reject
            </button>
            <p className="why">Approving only locks the text and picture. Publishing is a separate step, so nothing goes out by accident.</p>
           </div>
          </>
         )}

         {d.status==='approved'&&(
          <div className="actions">
           <button disabled={busy||!config?.publishing||!data?.connection}
            title={!config?.publishing?'PUBLISH_ENABLED is false in .env.local':!data?.connection?'Connect a LinkedIn account first':''}
            onClick={()=>{if(confirm('Post this publicly on LinkedIn now?'))act(()=>api(`/api/drafts/${d.id}/publish`,{}),'Published to LinkedIn.').then(ok=>{if(ok)setTab('published')})}}>
            Publish to LinkedIn
           </button>
           <p className="why">
            {!config?.publishing?'Publishing is switched off. Set PUBLISH_ENABLED=true in .env.local and restart the server.'
             :!data?.connection?'Connect your LinkedIn account above before publishing.'
             :'This posts publicly to your LinkedIn profile straight away.'}
           </p>
          </div>
         )}

         {['publishing','publish_uncertain','failed'].includes(d.status)&&(
          <div className="actions">
           <button className="secondary" disabled={busy}
            onClick={()=>{const postId=prompt('Confirm the post IS on LinkedIn.\n\nOptionally paste its post URN (urn:li:share:...), or leave empty:')??undefined;
             if(postId!==undefined)act(()=>api(`/api/drafts/${d.id}/reconcile`,{outcome:'posted',post_id:postId}),'Marked as published.')}}>
            It is on LinkedIn
           </button>
           <button className="secondary" disabled={busy}
            onClick={()=>{if(confirm('Confirm the post is NOT on LinkedIn.\n\nThe draft goes back to Ready to publish so you can try again.'))
             act(()=>api(`/api/drafts/${d.id}/reconcile`,{outcome:'not_posted'}),'Back in Ready to publish.')}}>
            Not on LinkedIn — allow retry
           </button>
           <p className="why">Open your LinkedIn profile and look for the post before choosing. Choosing wrong can create a duplicate post.</p>
          </div>
         )}

         <details className="history">
          <summary>History ({d.draft_versions.length} version{d.draft_versions.length>1?'s':''})</summary>
          {[...d.draft_versions].sort((a,b)=>b.version-a.version).map(ver=>{
           const fb=d.review_events.find(e=>e.version===ver.version-1&&e.action==='request_changes');
           return (
            <div className="history-item" key={ver.version}>
             <p className="meta">Version {ver.version}{ver.version===d.approved_version&&<span className="pill ok">approved</span>}<span className="dot"/>{new Date(ver.created_at).toLocaleString()}</p>
             {fb?.feedback&&<p className="feedback">Feedback: “{fb.feedback}”</p>}
             <p className="preview">{ver.body}</p>
            </div>
           );
          })}
         </details>
        </article>
       );
      })}
     </div>
    </div>
   </main>
  </>
 );
}

function Check({on,label,todo}:{on:boolean;label:string;todo:string}){
 return (
  <li>
   <span className={`tick ${on?'on':'off'}`}>{on?'✓':'!'}</span>
   <span>{label}{!on&&<span className="todo">{todo}</span>}</span>
  </li>
 );
}
