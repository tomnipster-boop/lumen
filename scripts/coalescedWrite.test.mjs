import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoalescedWrite} from '../src/lib/coalescedWrite.ts';
test('system controls serialize writes and keep only the newest pending slider value',async()=>{
 const calls=[]; let release;
 const writer=createCoalescedWrite(value=>{calls.push(value);return new Promise(resolve=>{release=resolve;});},100,()=>{});
 writer.push(10); const first=writer.flush();
 writer.push(20);writer.push(30);writer.push(40);
 assert.deepEqual(calls,[10]);release();await first;
 assert.deepEqual(calls,[10,40]);release();
});
test('closing flushes the latest value and errors do not block subsequent commands',async()=>{
 const errors=[],calls=[];
 const writer=createCoalescedWrite(async value=>{calls.push(value);if(value===2)throw Error('unavailable');},100,e=>errors.push(e.message));
 writer.push(1);writer.push(2);await writer.flush();writer.push(3);await writer.flush();
 assert.deepEqual(calls,[2,3]);assert.deepEqual(errors,['unavailable']);
});
