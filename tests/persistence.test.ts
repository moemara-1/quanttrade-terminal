import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, existsSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeskStore } from '../src/server/store.ts';
import type { Proposal } from '../src/shared/types.ts';
test('restart preserves budget and turns interrupted submission into non-retriable unknown',()=>{
  const dir=mkdtempSync(join(tmpdir(),'perp-desk-test-'));
  const path=join(dir,'desk.sqlite');
  let store=new DeskStore(path);
  try {
    const proposal: Proposal={id:'test',accountName:'desk',source:'manual',mode:'live',order:{venue:'lighter',symbol:'BTC-USDC',side:'buy',type:'limit',size:'1',price:'100',rationale:'test'},referencePrice:'100',estimatedNotional:'100',createdAt:Date.now(),expiresAt:Date.now()+120000,status:'pending'};
    store.save(proposal,'created');store.reserve('test','live','2026-09-28','100','1000');store.halted=true;
    for(let i=0;i<501;i++) store.save({...proposal,id:`newer-${i}`,status:'pending'},'created');
    store.close();
    store=new DeskStore(path);
    assert.equal(store.get('test').status,'unknown');assert.equal(store.used('live','2026-09-28'),'100');assert.equal(store.halted,true);
    assert.throws(()=>store.reserve('test','live','2026-09-28','100','1000'));
  } finally {
    store.close();
    for (const file of [path,`${path}-wal`,`${path}-shm`]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(dir);
  }
});
