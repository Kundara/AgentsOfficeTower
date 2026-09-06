const test = require('node:test');
const assert = require('node:assert/strict');
const { isOngoingThread } = require('../dist/snapshot-lib/thread-summary.js');
const { CodexAppServerClient } = require('../dist/app-server.js');
const turn = id => ({id,status:'completed',error:null,itemsView:'notLoaded',items:[]});
const item = (turnId,id) => ({turnId,item:{id,type:'agentMessage',text:id,phase:'commentary'}});
function fixture(handler) {
 const client = Object.create(CodexAppServerClient.prototype), requests=[];
 client.request=async(method,params)=>{requests.push({method,params});return method==='thread/read'?{thread:{id:'thread',updatedAt:Math.floor(Date.now()/1000),status:{type:'notLoaded'},turns:[]}}:handler(method,params);};
 return {client,requests};
}
test('full history pages turn metadata and items independently in chronological order',async()=>{
 const {client,requests}=fixture((method,p)=> method==='thread/turns/list'
  ?{data:[turn(p.cursor?'second':'first')],nextCursor:p.cursor?null:'turn-next'}
  :{data:[item(p.cursor?'second':'first',p.cursor?'b':'a')],nextCursor:p.cursor?null:'item-next'});
 const result=await client.readThread('thread');
 assert.ok(result.turns.every(t=>t.itemsView==='full'));
 assert.deepEqual(result.turns.map(t=>[t.id,t.items.map(i=>i.id)]),[['first',['a']],['second',['b']]]);
 assert.deepEqual(requests[0],{method:'thread/read',params:{threadId:'thread',includeTurns:false}});
 assert.ok(requests.filter(r=>r.method==='thread/turns/list').every(r=>r.params.itemsView==='notLoaded'));
 assert.ok(requests.filter(r=>r.method==='thread/items/list').every(r=>r.params.limit===5&&r.params.sortDirection==='asc'));
});
test('empty history needs no item read',async()=>{
 const {client,requests}=fixture(()=>({data:[],nextCursor:null}));
 assert.deepEqual((await client.readThread('thread')).turns,[]);assert.equal(requests.length,2);
});
test('full history rejects turn and item cursor cycles',async()=>{
 for(const methodToCycle of ['thread/turns/list','thread/items/list']) {
  const {client}=fixture(method=>({data:method==='thread/turns/list'?[turn('one')]:[item('one','a')],nextCursor:method===methodToCycle?'repeat':null}));
  await assert.rejects(client.readThread('thread'),/repeated cursor/);
 }
});
test('full history bounds turn pages and propagates failures',async()=>{
 let page=0;const {client}=fixture(()=>({data:[turn(String(page))],nextCursor:String(++page)}));
 await assert.rejects(client.readThread('thread'),/exceeded 100 pages/);
 await assert.rejects(fixture(()=>{throw new Error('offline');}).client.readThread('thread'),/offline/);
});
test('malformed item data, cursors and unknown turns fail explicitly',async()=>{
 for(const page of [{data:[{}],nextCursor:null},{data:[],nextCursor:undefined},{data:[item('missing','a')],nextCursor:null}]) {
  const {client}=fixture(method=>method==='thread/turns/list'?{data:[turn('one')],nextCursor:null}:page);
  await assert.rejects(client.readThread('thread'),/incomplete|unknown turn/);
 }
});
test('oversized item pages shrink at the same cursor without dropping items',async()=>{
 const {client,requests}=fixture((method,p)=>{
  if(method==='thread/turns/list')return {data:[turn('one')],nextCursor:null};
  if(p.limit>1)throw new Error('app-server message exceeded 8388608 bytes');
  return {data:[item('one','safe')],nextCursor:null};
 });
 assert.equal((await client.readThread('thread')).turns[0].items[0].id,'safe');
 assert.deepEqual(requests.filter(r=>r.method==='thread/items/list').map(r=>r.params.limit),[5,2,1]);
});
test('workload reads only recent turns and a bounded recent action window',async()=>{
 let pages=0;
 const {client,requests}=fixture((method,p)=>{
  if(method==='thread/turns/list')return {data:[{...turn('new'),status:'inProgress',itemsView:'summary',items:[item('new','summary').item]},turn('old')],nextCursor:'older-history'};
  assert.equal(p.turnId,'new');assert.equal(p.sortDirection,'desc');
  return {data:[item('new',String(4-pages++))],nextCursor:'items-'+pages};
 });
 const r=await client.readThread('thread',{history:'workload'});
 assert.equal(pages,4);assert.equal(requests[1].params.itemsView,'summary');
 assert.deepEqual(r.turns.map(t=>t.id),['old','new']);
 assert.equal(r.turns[1].status,'inProgress');
 assert.equal(isOngoingThread(r),true);
 assert.deepEqual(r.turns[1].items.map(i=>i.id),['summary','1','2','3','4']);
});
test('workload deduplicates summary final answers and keeps final as latest item',async()=>{
 const final={...item('new','final').item,phase:'final_answer'};
 const {client}=fixture(method=>method==='thread/turns/list'
  ?{data:[{...turn('new'),itemsView:'summary',items:[final]}],nextCursor:null}
  :{data:[{turnId:'new',item:final},item('new','before')],nextCursor:null});
 const r=await client.readThread('thread',{history:'workload'});
 assert.deepEqual(r.turns[0].items.map(i=>i.id),['before','final']);
 assert.equal(r.turns[0].items.at(-1).phase,'final_answer');
 assert.equal(isOngoingThread(r),false);
});

test('observer resume can exclude history before bounded workload hydration',async()=>{
 const {client,requests}=fixture(()=>({thread:{id:'thread',turns:[]}}));
 await client.resumeThread('thread',true);
 assert.deepEqual(requests[0],{method:'thread/resume',params:{excludeTurns:true,threadId:'thread'}});
});
