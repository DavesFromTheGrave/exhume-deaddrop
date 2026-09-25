import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";
import { ladderFor, LADDER_IDS } from "./ladder.js";
import { deriveSecret, daySeed } from "./secret.js";

function fixture(ladder) {
 const records=[],kv=new Map();
 const env={PROVIDER:"mock",LADDER:ladder,SERVER_KEY:"synthetic-message-limit-test",EXHUME_KV:{
  get:async key=>kv.get(key)??null,put:async(key,value)=>kv.set(key,value),delete:async key=>kv.delete(key)
 },EXHUME_DB:{prepare:()=>({bind:(...args)=>({run:async()=>{records.push(args);}})})}};
 async function post(path,body){
  const response=await worker.fetch(new Request("https://test.invalid/api/"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:"test-player",...body})}),env);
  return {status:response.status,data:await response.json()};
 }
 // An attempt must be open before a turn; admin is off, so open levels in order.
 async function start(levelId){return post("start",{levelId});}
 async function turn(levelId,message){return post("turn",{levelId,message});}
 return {env,records,kv,post,start,turn};
}

for(const ladder of LADDER_IDS){
 const {LEVELS,publicLevel}=ladderFor({LADDER:ladder});
 test(`[${ladder}] public campaign exposes no game cap for levels 1-4, then 4000`,()=>{
  for(const level of LEVELS)assert.equal(publicLevel(level).messageCharLimit,level.id<=4?null:4000);
 });
}

for(const [level,ending] of [[1,"hello"],[2,"instructions"],[3,"hint"],[4,"story"]]){
 test("crypt "+level+" receives the complete message beyond character 4000",async()=>{
  const f=fixture("35"),message="a".repeat(12000)+" "+ending;
  // clear the levels before it so this one is open
  for(let id=1;id<level;id++){
   await f.start(id);
   const s=await deriveSecret(f.env.SERVER_KEY,"test-player",id,daySeed());
   assert.equal((await f.post("claim",{levelId:id,claim:s})).data.win,true);
  }
  assert.equal((await f.start(level)).status,200);
  const before=f.records.length;
  const result=await f.turn(level,message);
  const secret=await deriveSecret(f.env.SERVER_KEY,"test-player",level,daySeed());
  assert.equal(result.status,200);assert.ok(result.data.reply.includes(secret));
  assert.equal(f.records[before][8],message);
 });
}
test("overlong later message is rejected without truncation, logging or spending",async()=>{
 const f=fixture("35"),result=await f.turn(5,"story hint "+"a".repeat(3990));
 assert.equal(result.status,413);assert.equal(result.data.code,"MESSAGE_TOO_LONG");assert.equal(result.data.limit,4000);
 assert.equal(f.records.length,0);assert.equal(f.kv.size,0);
});
test("exactly 4000 characters is accepted on crypt 5",async()=>{
 const f=fixture("35"),message="story hint "+"a".repeat(3989);
 assert.equal(message.length,4000);
 const admin={...f.env,TRUST_IDENTITY_HEADERS:"1"};
 const req=(path,body)=>new Request("https://test.invalid/api/"+path,{method:"POST",headers:{"content-type":"application/json","x-player-id":"test-player","x-admin":"1"},body:JSON.stringify(body)});
 assert.equal((await worker.fetch(req("start",{levelId:5}),admin)).status,200);
 const r=await worker.fetch(req("turn",{levelId:5,message}),admin);
 assert.equal(r.status,200);assert.equal(f.records[0][8],message);
});
test("a turn with no open attempt is refused and spends nothing",async()=>{
 const f=fixture("35"),result=await f.turn(1,"hello");
 assert.equal(result.status,409);assert.equal(result.data.code,"NO_ATTEMPT");
 assert.equal(f.records.length,0);
});
test("empty early messages are still rejected",async()=>{
 const f=fixture("35"),result=await f.turn(3,"  ");
 assert.equal(result.status,400);assert.equal(f.kv.size,0);
});
