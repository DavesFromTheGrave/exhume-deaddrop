import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";
import { LEVELS, publicLevel } from "./levels.js";
import { deriveSecret } from "./secret.js";

function fixture() {
 const records=[],kv=new Map();
 const env={PROVIDER:"mock",SERVER_KEY:"synthetic-message-limit-test",EXHUME_KV:{
  get:async key=>kv.get(key)??null,put:async(key,value)=>kv.set(key,value)
 },EXHUME_DB:{prepare:()=>({bind:(...args)=>({run:async()=>{records.push(args);}})})}};
 async function turn(levelId,message){
  const response=await worker.fetch(new Request("https://test.invalid/api/turn",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:"test-player",levelId,message})}),env);
  return {status:response.status,data:await response.json()};
 }
 return {env,records,kv,turn};
}
test("public campaign exposes no game cap for crypts 1-4, then 4000",()=>{
 for(const level of LEVELS)assert.equal(publicLevel(level).messageCharLimit,level.id<=4?null:4000);
});
for(const [level,ending] of [[1,"hello"],[2,"instructions"],[3,"hint"],[4,"story"]]){
 test("crypt "+level+" receives the complete message beyond character 4000",async()=>{
  const f=fixture(),message="a".repeat(12000)+" "+ending;
  const result=await f.turn(level,message);
  const secret=await deriveSecret(f.env.SERVER_KEY,"test-player",level);
  assert.equal(result.status,200);assert.ok(result.data.reply.includes(secret));
  assert.equal(f.records[0][8],message);
 });
}
test("overlong later message is rejected without truncation, logging or spending",async()=>{
 const f=fixture(),result=await f.turn(5,"story hint "+"a".repeat(3990));
 assert.equal(result.status,413);assert.equal(result.data.code,"MESSAGE_TOO_LONG");assert.equal(result.data.limit,4000);
 assert.equal(f.records.length,0);assert.equal(f.kv.size,0);
});
test("exactly 4000 characters is accepted on crypt 5",async()=>{
 const f=fixture(),message="story hint "+"a".repeat(3989);
 assert.equal(message.length,4000);
 const result=await f.turn(5,message);assert.equal(result.status,200);assert.equal(f.records[0][8],message);
});
test("empty early messages are still rejected",async()=>{
 const f=fixture(),result=await f.turn(3,"  ");
 assert.equal(result.status,400);assert.equal(f.kv.size,0);
});
