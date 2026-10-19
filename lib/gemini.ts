type Article={title:string;url:string;source:string|null;summary:string|null;published_at:string|null};

const RULES=`You write LinkedIn posts about immigration news for a professional audience.
Rules:
- Objective, factual, short and to the point: 500 to 1200 characters.
- First line: one clear sentence stating the news itself. No clickbait, no questions.
- Then 2 to 4 short lines covering what changed, who it affects, and key dates or numbers.
- Use only facts present in the SOURCE section. If a detail is not there, leave it out. Never invent numbers, dates, names or quotes.
- No legal advice, no personal opinions, no political commentary, no emojis.
- Plain text only. No markdown, no asterisks, no bold.
- Last lines: "Source: <source name> <source link>" on its own line, then 2 or 3 relevant hashtags on one line.
Return only the post text.`;

function source(article:Article,articleText:string){
 return `SOURCE
Headline: ${article.title}
Publisher: ${article.source||'unknown'}
Published: ${article.published_at||'unknown'}
Link: ${article.url}
Reviewer notes / summary: ${article.summary||'none'}
Article text:
${articleText||'(article text could not be read; rely only on the headline and notes above and keep the post brief)'}`;
}

export async function writePost(input:{article:Article;articleText:string;current?:string;feedback?:string}){
 const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('Gemini API key is not configured');
 const model=process.env.GEMINI_MODEL||'gemini-3.8-flash';
 const task=input.current
  ?`CURRENT DRAFT
${input.current}

REVIEWER FEEDBACK
${input.feedback}

Rewrite the draft so it fully applies the reviewer feedback while keeping every rule above. If the feedback asks for a fact that is not in the SOURCE, do not invent it.`
  :'Write the post.';
 const prompt=`${RULES}\n\n${source(input.article,input.articleText)}\n\n${task}`;
 // Gemini models are often briefly overloaded (503). Try the configured model, then fallbacks, within one time budget.
 const fallbacks=(process.env.GEMINI_FALLBACK_MODELS??'gemini-3.5-flash,gemini-2.5-flash').split(',').map(x=>x.trim()).filter(Boolean);
 const models=[...new Set([model,...fallbacks])];
 const deadline=Date.now()+45000;let last='Gemini generation failed';
 for(let round=0;round<3&&Date.now()<deadline-3000;round++){
  for(const m of models){
   const remaining=deadline-Date.now();if(remaining<3000)break;
   try{
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,{
     method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},
     body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.3,maxOutputTokens:4096,...(m.startsWith('gemini-3')?{thinkingConfig:{thinkingLevel:'low'}}:{})}}),
     signal:AbortSignal.timeout(Math.min(25000,remaining)),cache:'no-store'
    });
    if(response.ok){
     const result=await response.json();
     const body=(result.candidates?.[0]?.content?.parts||[]).filter((p:{thought?:boolean})=>!p.thought).map((p:{text?:string})=>p.text||'').join('').trim();
     if(body)return body.replace(/\*\*(.+?)\*\*/g,'$1').slice(0,3000);
     last='Gemini returned no text';continue;
    }
    if(response.status===400||response.status===401||response.status===403)throw new Error(`Gemini rejected the request (${response.status}); check GEMINI_API_KEY and GEMINI_MODEL`);
    last=response.status===429?'Gemini quota reached; try again in a minute':'Gemini is busy right now; try again in a minute';
   }catch(e){
    if(e instanceof Error&&e.message.startsWith('Gemini rejected'))throw e;
    last='Gemini is busy right now; try again in a minute';
   }
  }
  await new Promise(r=>setTimeout(r,1500));
 }
 throw new Error(last);
}
