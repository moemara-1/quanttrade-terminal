import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeskStore } from '../src/server/store.ts';

test('operation retries return recorded results and never claim a second submission',()=>{
  const store=new DeskStore(':memory:');
  try {
    assert.equal(store.claimOperation('request','fingerprint'),null);
    assert.deepEqual(store.claimOperation('request','fingerprint'),{state:'submitting',result:null});
    store.finishOperation('request','completed',{leverage:3});
    assert.deepEqual(store.claimOperation('request','fingerprint'),{state:'completed',result:{leverage:3}});
    assert.throws(()=>store.claimOperation('request','different'),/different exchange operation/);
  } finally {store.close();}
});

test('a restart marks an interrupted exchange mutation unknown rather than retryable',()=>{
  const directory=mkdtempSync(join(tmpdir(),'quanttrade-operations-'));
  const path=join(directory,'desk.sqlite');
  let store=new DeskStore(path);
  try {
    store.claimOperation('interrupted','fingerprint');store.close();
    store=new DeskStore(path);
    assert.deepEqual(store.claimOperation('interrupted','fingerprint'),{state:'unknown',result:null});
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});
