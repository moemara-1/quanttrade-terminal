import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostedAuth } from '../src/server/hosted-auth.ts';
test('hosted sessions persist hashed tokens, revoke, expire and bind credentials',()=>{
 const dir=mkdtempSync(join(tmpdir(),'qt-auth-'));const file=join(dir,'sessions.sqlite');
 const credentials={username:'operator',password:'test-password'};let now=1000;
 let auth=new HostedAuth({sessionFile:file,credentials:()=>credentials,now:()=>now});
 try {assert.equal(auth.authenticate('operator','wrong'),false);assert.equal(auth.authenticate('operator','test-password'),true);
 const token=auth.issue(true);assert.ok(auth.valid(token));auth.close();auth=new HostedAuth({sessionFile:file,credentials:()=>credentials,now:()=>now});assert.ok(auth.valid(token));
 auth.revoke(token);assert.equal(auth.valid(token),false);const short=auth.issue(false);now+=12*60*60*1000;assert.equal(auth.valid(short),false);
 const bound=auth.issue(true);credentials.password='changed';assert.equal(auth.valid(bound),false);
 }finally{auth.close();rmSync(dir,{recursive:true,force:true});}
});
