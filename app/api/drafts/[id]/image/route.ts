import {randomUUID} from 'node:crypto';
import {reviewer,db,json} from '../../../../../lib/server';
import {BUCKET,MAX_UPLOAD,ensureBucket,storageRef} from '../../../../../lib/images';
import {z} from 'zod';
export const runtime='nodejs';
// Uploads a JPEG/PNG for a draft and saves it, with the given text, as a new version.
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await reviewer(req);if(!user)return json({error:'Forbidden'},403);
 const {id}=await params;if(!z.string().uuid().safeParse(id).success)return json({error:'Invalid draft'},400);
 const form=await req.formData().catch(()=>null);const file=form?.get('file');
 const expected=Number(form?.get('expected_version')),body=String(form?.get('body')||'');
 if(!(file instanceof File)||!Number.isInteger(expected)||expected<1)return json({error:'Choose a picture to upload'},400);
 const bytes=Buffer.from(await file.arrayBuffer());
 const type=bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))?'jpg':bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))?'png':null;
 if(!type)return json({error:'The picture must be a JPEG or PNG file'},400);
 if(bytes.length>MAX_UPLOAD)return json({error:'The picture must be under 4 MB'},400);
 try{await ensureBucket()}catch(e){return json({error:e instanceof Error?e.message:'Image storage unavailable'},500)}
 const path=`${id}/${randomUUID()}.${type}`;
 const {error:uploadError}=await db().storage.from(BUCKET).upload(path,bytes,{contentType:type==='png'?'image/png':'image/jpeg',upsert:false});
 if(uploadError)return json({error:`Upload failed: ${uploadError.message}`},500);
 const {data,error}=await db().rpc('add_draft_version',{p_id:id,p_expected_version:expected,p_actor:user.id,p_body:body,p_image_url:storageRef(path)});
 if(error){await db().storage.from(BUCKET).remove([path]);return json({error:error.message},409)}
 return json({version:data},201);
}
