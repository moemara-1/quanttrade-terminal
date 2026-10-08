import test from 'node:test';
import assert from 'node:assert/strict';
import { DeskStore } from '../src/server/store.ts';
import { validateSyncEntries } from '../src/server/sync-state.ts';

test('hosted sync merges per-key clocks and does not overwrite newer layouts',()=>{
 const store=new DeskStore(':memory:');try{
  store.mergeSyncEntries(validateSyncEntries({language:{value:'en',updatedAt:20}}));
  store.mergeSyncEntries(validateSyncEntries({language:{value:'de',updatedAt:10},'terminal.layout.perp':{value:{panes:[]},updatedAt:30}}));
  assert.equal(store.syncEntries().language.value,'en');assert.deepEqual(store.syncEntries()['terminal.layout.perp'].value,{panes:[]});
 }finally{store.close();}
});
test('hosted sync rejects secrets, trust anchors, execution configuration and unknown domains',()=>{
 for(const key of ['credentials-store:lighter','security.lock','plugin-registry-settings','trade:swapPresets','assistant.conversations','workflows','workspace.bad.layout.secret','unknown'])
  assert.throws(()=>validateSyncEntries({[key]:{value:{},updatedAt:1}}));
 assert.throws(()=>validateSyncEntries({'terminal.layout':{value:{privateKey:'synthetic-secret'},updatedAt:1}}));
 assert.throws(()=>validateSyncEntries({language:{value:'en',updatedAt:Date.now()+60000}}));
});

test('hosted watchlists preserve instrument refs and reject ambiguous identities',()=>{
 const valid={activeListId:'favorites',lists:[{id:'favorites',name:'Favorites',symbols:['perp:PRL-USDC-USDC','spot:BTC-USDT']}]};
 assert.deepEqual(validateSyncEntries({'hosted.watchlists':{value:valid,updatedAt:0}})['hosted.watchlists'].value,valid);
 assert.throws(()=>validateSyncEntries({'hosted.watchlists':{value:{...valid,activeListId:'missing'},updatedAt:0}}));
 assert.throws(()=>validateSyncEntries({'hosted.watchlists':{value:{...valid,lists:[...valid.lists,...valid.lists]},updatedAt:0}}));
});
