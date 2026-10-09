import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
export interface WebCredentials {username:string;password:string}
export const webCredentialsSchema=z.object({username:z.string().min(1).max(128),password:z.string().min(1).max(1024)});
export function readWebCredentials(file:string):WebCredentials{
 try{return webCredentialsSchema.parse(JSON.parse(readFileSync(file,'utf8')));}
 catch{throw new Error('Hosted sign-in credentials are unavailable');}
}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function equal(left:string,right:string){return timingSafeEqual(Buffer.from(hash(left),'hex'),Buffer.from(hash(right),'hex'));}
export class HostedAuth {
 private readonly db:DatabaseSync;
 private readonly clock:()=>number;
 constructor(private readonly settings:{sessionFile:string;credentials?:()=>WebCredentials;now?:()=>number}){
  this.clock=settings.now??Date.now;
  if(settings.sessionFile!==':memory:')mkdirSync(dirname(settings.sessionFile),{recursive:true});
  this.db=new DatabaseSync(settings.sessionFile);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS web_sessions(tokenHash TEXT PRIMARY KEY,expiresAt INTEGER NOT NULL,credentialHash TEXT NOT NULL)');
  if(settings.sessionFile!==':memory:')chmodSync(settings.sessionFile,0o600);
 }
 private fingerprint(){const c=this.settings.credentials?.();return hash(c?JSON.stringify([c.username,c.password]):'trusted-proxy');}
 authenticate(username:string,password:string){const credentials=this.settings.credentials?.();const validUser=equal(username,credentials?.username??'');const validPassword=equal(password,credentials?.password??'');return !!credentials&&validUser&&validPassword;}
 issue(remember:boolean){this.db.prepare('DELETE FROM web_sessions WHERE expiresAt<=? OR credentialHash<>?').run(this.clock(),this.fingerprint());
  const count=this.db.prepare('SELECT count(*) AS count FROM web_sessions').get();if(Number(count?.count)>=100)throw new Error('Too many active sessions');
  const token=randomBytes(32).toString('hex');this.db.prepare('INSERT INTO web_sessions VALUES(?,?,?)').run(hash(token),this.clock()+(remember?30*24:12)*60*60*1000,this.fingerprint());return token;
 }
 valid(token:string){if(!/^[a-f0-9]{64}$/.test(token))return false;const row=this.db.prepare('SELECT expiresAt,credentialHash FROM web_sessions WHERE tokenHash=?').get(hash(token));return !!row&&Number(row.expiresAt)>this.clock()&&equal(String(row.credentialHash),this.fingerprint());}
 revoke(token:string){this.db.prepare('DELETE FROM web_sessions WHERE tokenHash=?').run(hash(token));}
 close(){this.db.close();}
}
