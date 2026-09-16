// Local design preview only. Uses the existing game Worker with a fixed mock provider.
// No external inference, accounts, checkout calls, or production bindings.
import http from "node:http";
import { readFile } from "node:fs/promises";
import worker from "../worker/index.js";
const root = new URL("./",import.meta.url);
const assets = new Map([
 ["/",["index.html","text/html; charset=utf-8"]],
 ["/index.html",["index.html","text/html; charset=utf-8"]],
 ["/style.css",["style.css","text/css; charset=utf-8"]],
 ["/app.js",["app.js","text/javascript; charset=utf-8"]],
 ["/catalog.js",["catalog.js","text/javascript; charset=utf-8"]],
 ["/assets/sigil.png",["assets/sigil.png","image/png"]],
 ["/curriculum/how-prompt-injection-works.html",["../public/curriculum/how-prompt-injection-works.html","text/html; charset=utf-8"]],
 ["/curriculum/red-team-onboarding.html",["../public/curriculum/red-team-onboarding.html","text/html; charset=utf-8"]]
]);
const port=Number(process.env.PREVIEW_PORT||4321);
const origin="http://127.0.0.1:"+port;
const env={PROVIDER:"mock",DAILY_CANDLES:"60",GLOBAL_DAILY_TURNS:"5000"};
const server=http.createServer(async(req,res)=>{
 const headers={"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","x-frame-options":"DENY"};
 try{
  if(req.headers.host!=="127.0.0.1:"+port && req.headers.host!=="localhost:"+port){res.writeHead(403,headers);res.end("Local preview only.");return;}
  if(req.method==="POST" && req.headers.origin && ![origin,"http://localhost:"+port].includes(req.headers.origin)){res.writeHead(403,headers);res.end("Origin not allowed.");return;}
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith("/api/")){
   if(!["GET","POST"].includes(req.method)){res.writeHead(405,headers);res.end();return;}
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>131072){res.writeHead(413,{...headers,"content-type":"application/json"});res.end(JSON.stringify({error:"The full request exceeds the local preview’s 128 KiB transport limit. Nothing was sent or shortened. Shorten the message or restart the crypt to clear conversation history."}));return;}chunks.push(chunk);}
   const request=new Request(url,{method:req.method,headers:{"content-type":"application/json"},body:req.method==="POST"?Buffer.concat(chunks):undefined});
   const result=await worker.fetch(request,env);
   res.writeHead(result.status,{...headers,"content-type":result.headers.get("content-type")||"application/json"});
   res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  if(!["GET","HEAD"].includes(req.method)){res.writeHead(405,headers);res.end();return;}
  const asset=assets.get(url.pathname);if(!asset){res.writeHead(404,headers);res.end("Not found");return;}
  const body=await readFile(new URL(asset[0],root));
  res.writeHead(200,{...headers,"content-type":asset[1]});res.end(req.method==="HEAD"?undefined:body);
 }catch{res.writeHead(500,headers);res.end("The local preview could not complete this request.");}
});
server.requestTimeout=25000;
server.listen(port,"127.0.0.1",()=>console.info("Design preview: "+origin));
