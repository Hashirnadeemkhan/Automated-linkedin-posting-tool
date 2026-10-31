// How much a news source can be trusted. Official = a government immigration body.
// Trusted = established national news organisations and specialist immigration publishers.
export type Trust='official'|'trusted'|'other';

const OFFICIAL_HOSTS=[/\.gov$/,/\.gov\.uk$/,/\.gc\.ca$/,/(^|\.)canada\.ca$/,/\.gov\.au$/,/\.govt\.nz$/,/\.gov\.pk$/,/\.gov\.in$/,/(^|\.)europa\.eu$/];

// [display name, website]. Names are matched without a leading "The" and without Bing's " on MSN" suffix.
const TRUSTED:[string,string][]=[
 // wires + international
 ['Reuters','reuters.com'],['Associated Press','apnews.com'],['AP News','apnews.com'],['AFP','afp.com'],['Bloomberg','bloomberg.com'],
 ['BBC','bbc.com'],['BBC News','bbc.co.uk'],['Al Jazeera','aljazeera.com'],['Financial Times','ft.com'],['Economist','economist.com'],
 ['Deutsche Welle','dw.com'],['DW','dw.com'],['France 24','france24.com'],['Euronews','euronews.com'],['Diplomat','thediplomat.com'],
 ['UN News','news.un.org'],['UNHCR','unhcr.org'],['IOM','iom.int'],
 // United States
 ['New York Times','nytimes.com'],['Washington Post','washingtonpost.com'],['Wall Street Journal','wsj.com'],['USA Today','usatoday.com'],
 ['Los Angeles Times','latimes.com'],['CNN','cnn.com'],['NPR','npr.org'],['CBS News','cbsnews.com'],['NBC News','nbcnews.com'],
 ['ABC News','abcnews.go.com'],['PBS','pbs.org'],['Axios','axios.com'],['Politico','politico.com'],['The Hill','thehill.com'],
 ['Forbes','forbes.com'],['CNBC','cnbc.com'],['Fox News','foxnews.com'],['Newsweek','newsweek.com'],['Time','time.com'],
 ['Atlanta Journal-Constitution','ajc.com'],['Baltimore Sun','baltimoresun.com'],['Chicago Tribune','chicagotribune.com'],['Miami Herald','miamiherald.com'],['Houston Chronicle','houstonchronicle.com'],
 ['Bloomberg Law','news.bloomberglaw.com'],['Roll Call','rollcall.com'],['Boundless','boundless.com'],['Fragomen','fragomen.com'],
 // United Kingdom
 ['Guardian','theguardian.com'],['Times','thetimes.com'],['Telegraph','telegraph.co.uk'],['Independent','independent.co.uk'],
 ['Sky News','news.sky.com'],['LBC','lbc.co.uk'],['ITV News','itv.com'],['Financial Times','ft.com'],['Evening Standard','standard.co.uk'],['iNews','inews.co.uk'],
 // Canada
 ['CBC','cbc.ca'],['CBC News','cbc.ca'],['CTV News','ctvnews.ca'],['Global News','globalnews.ca'],['Globe and Mail','theglobeandmail.com'],
 ['Toronto Star','thestar.com'],['National Post','nationalpost.com'],['CIC News','cicnews.com'],
 // Australia + New Zealand
 ['ABC','abc.net.au'],['SBS News','sbs.com.au'],['Sydney Morning Herald','smh.com.au'],['RNZ','rnz.co.nz'],
 // South Asia + Gulf
 ['Dawn','dawn.com'],['Express Tribune','tribune.com.pk'],['Geo News','geo.tv'],['Business Recorder','brecorder.com'],
 ['Times of India','timesofindia.indiatimes.com'],['Economic Times','economictimes.indiatimes.com'],['Hindustan Times','hindustantimes.com'],
 ['Business Standard','business-standard.com'],['ARY News','arynews.tv'],['Deccan Herald','deccanherald.com'],
 ['Indian Express','indianexpress.com'],['NDTV','ndtv.com'],['Hindu','thehindu.com'],['Mint','livemint.com'],
 ['Gulf News','gulfnews.com'],['Khaleej Times','khaleejtimes.com'],['National','thenationalnews.com'],['Arab News','arabnews.com']
];

const norm=(s:string)=>s.toLowerCase().replace(/\s+on msn$/,'').replace(/^the\s+/,'').replace(/&amp;/g,'&').trim();
const NAMES=new Set(TRUSTED.map(([n])=>norm(n)));

export function trustOf(url:string,source:string):Trust{
 let host='';try{host=new URL(url).hostname.toLowerCase().replace(/^www\./,'')}catch{}
 if(host&&OFFICIAL_HOSTS.some(r=>r.test(host)))return 'official';
 if(host&&TRUSTED.some(([,h])=>host===h||host.endsWith('.'+h)))return 'trusted';
 // Google News links point at news.google.com, so fall back to the publisher name.
 return NAMES.has(norm(source))?'trusted':'other';
}
export const cleanSource=(s:string)=>s.replace(/\s+on MSN$/i,'').trim();
