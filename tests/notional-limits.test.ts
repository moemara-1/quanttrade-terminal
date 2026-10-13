import test from 'node:test';
import assert from 'node:assert/strict';
import { notionalLimit } from '../src/server/notional-limits.ts';
test('notional limits default to explicit disabled null and preserve finite opt-in caps',()=>{assert.equal(notionalLimit.parse(undefined),null);assert.equal(notionalLimit.parse('off'),null);assert.equal(notionalLimit.parse('1000'),'1000');for(const invalid of ['0','-1','Infinity','NaN','1e10',''])assert.equal(notionalLimit.safeParse(invalid).success,false);});
