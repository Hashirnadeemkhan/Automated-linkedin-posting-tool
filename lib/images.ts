import {db} from './server';

// Uploaded pictures live in a private Supabase Storage bucket and are referenced as storage://post-images/<path>.
export const BUCKET='post-images';
export const MAX_UPLOAD=4_000_000; // stays under Vercel's 4.5 MB request body limit
const PREFIX=`storage://${BUCKET}/`;
export const isStorageRef=(ref:string|null|undefined)=>!!ref&&/^storage:\/\/post-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png)$/.test(ref);
export const storagePath=(ref:string)=>ref.slice(PREFIX.length);
export const storageRef=(path:string)=>PREFIX+path;

export async function ensureBucket(){
 const {error}=await db().storage.createBucket(BUCKET,{public:false,fileSizeLimit:MAX_UPLOAD,allowedMimeTypes:['image/jpeg','image/png']});
 if(error&&!/already exists|duplicate/i.test(error.message))throw new Error(`Image storage unavailable: ${error.message}`);
}

export async function signedPreviews(refs:string[]){
 const paths=[...new Set(refs.filter(isStorageRef).map(storagePath))];
 if(!paths.length)return new Map<string,string>();
 const {data}=await db().storage.from(BUCKET).createSignedUrls(paths,3600);
 return new Map((data||[]).filter(x=>x.signedUrl&&x.path).map(x=>[storageRef(x.path!),x.signedUrl]));
}

export async function downloadStored(ref:string){
 const {data,error}=await db().storage.from(BUCKET).download(storagePath(ref));
 if(error||!data)throw new Error('Uploaded image could not be read from storage');
 return {bytes:Buffer.from(await data.arrayBuffer()),type:ref.endsWith('.png')?'image/png':'image/jpeg'};
}
