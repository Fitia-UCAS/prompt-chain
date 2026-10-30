const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const load=()=>import(pathToFileURL(path.join(__dirname,'../background/scheduler.mjs')).href);
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('单次 tick 卡在页面上时，后续唤醒仍会开始新的 tick',async()=>{
  const {createScheduler}=await load();
  let now=1000,calls=0,hang=true;
  const scheduler=createScheduler({
    tick:()=>{calls++;return hang?new Promise(()=>{}):Promise.resolve();},
    timers:{setTimeout(){return 1;},clearTimeout(){}},
    clock:{now:()=>now},
    staleAfterMs:30000
  });
  scheduler.requestTick();await flush();
  assert.equal(calls,1);
  now+=1000;scheduler.requestTick();await flush();
  assert.equal(calls,1,'同一次唤醒还不能把仍在进行中的 tick 视为卡住');
  now+=30000;hang=false;scheduler.requestTick();await flush();
  assert.equal(calls,2,'超过停滞窗口后必须脱离卡住的链路');
  await scheduler.idle();
});

test('空闲后的唤醒不会被旧的卡住链阻塞',async()=>{
  const {createScheduler}=await load();
  let now=0,calls=0;
  const scheduler=createScheduler({
    tick:()=>{calls++;return Promise.resolve();},
    timers:{setTimeout(){return 1;},clearTimeout(){}},
    clock:{now:()=>now}
  });
  scheduler.requestTick();await scheduler.idle();await flush();
  now+=100;scheduler.requestTick();await scheduler.idle();await flush();
  assert.equal(calls,2);
});
