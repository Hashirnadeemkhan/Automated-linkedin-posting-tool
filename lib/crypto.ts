import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
function key(){const raw=Buffer.from(process.env.TOKEN_ENCRYPTION_KEY||'','base64');if(raw.length!==32)throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes in base64');return raw}
export function encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv),body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64')}
export function decrypt(value:string){const raw=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key(),raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));return Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8')}
