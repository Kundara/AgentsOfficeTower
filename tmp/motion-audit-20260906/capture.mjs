import fs from 'node:fs';
import vm from 'node:vm';
import {CLIENT_RUNTIME_SEATING_SOURCE} from '../../packages/web/dist/client/runtime/seating-source.js';
const ctx=vm.createContext({Date,state:{},parseAgentUpdatedAt: x=>Date.parse(x||''),isDeskLiveLocalState:s=>!['idle','done'].includes(s)});
vm.runInContext(CLIENT_RUNTIME_SEATING_SOURCE+';globalThis.seat=shouldSeatAtWorkstation;',ctx);
const file=new URL('./fleet.jsonl',import.meta.url);
const end=Date.now()+180000;
let n=0;
while(Date.now()<end){
 const f=await(await fetch('http://127.0.0.1:4181/api/fleet')).json();
 const row={at:new Date().toISOString(),projects:f.projects.map(p=>({projectRoot:p.projectRoot,projectLabel:p.projectLabel,generatedAt:p.generatedAt,agents:p.agents.map(a=>({...a,seat:ctx.seat(a)})),events:p.events}))};
 fs.appendFileSync(file,JSON.stringify(row)+'\n'); n++;
 await new Promise(r=>setTimeout(r,1000));
}
console.log(JSON.stringify({samples:n,file:file.pathname}));
