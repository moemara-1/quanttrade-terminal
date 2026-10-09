import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGraphState,tickWorkflowGraph,workflowGraphSchema,hyperliquidOcoTopology,hyperliquidOcoTopologies,type WorkflowGraph,type GraphCallbacks} from '../src/server/workflow-graph.ts';
import type {Market,OrderDraft} from '../src/shared/types.ts';
const input:OrderDraft={venue:'lighter',symbol:'PRL-USDC',side:'buy',size:'10',type:'market',rationale:'Test'};
const market:Market={venue:'lighter',symbol:'PRL-USDC',base:'PRL',price:'100',change24h:0,volume24h:'0',fundingRate:null,openInterest:null,sizeDecimals:2,priceDecimals:2,minSize:'1',minNotional:'1',updatedAt:0};
const node=(id:string,type:WorkflowGraph['steps'][number]['type'],data:Record<string,unknown>={})=>({id,type,data});
const edge=(source:string,target:string,sourceHandle?:string)=>({id:source+target,source,target,...(sourceHandle?{sourceHandle}:{})});
const buy={side:'inherit',sizeMode:'percent',size:100};
test('saved original core defaults remain compatible including inactive zero protective limit prices',()=>{
  const defaults=[node('t','trigger'),node('m','market-order',{side:'inherit',sizeMode:'percent',size:100}),node('l','limit-order',{side:'inherit',sizeMode:'percent',size:100,priceMode:'offset-percent',priceValue:0}),node('tp','take-profit',{triggerMode:'percent',triggerValue:5,sizePercent:100,orderType:'market',limitPrice:0}),node('sl','stop-loss',{triggerMode:'percent',triggerValue:3,sizePercent:100,orderType:'market',limitPrice:0}),node('c','condition',{conditionType:'price-above',value:100}),node('b','split',{branches:2}),node('w','wait',{duration:5,unit:'seconds'})];
  const graph={steps:defaults,edges:[edge('t','m'),edge('m','l'),edge('l','tp'),edge('l','sl'),edge('m','c'),edge('c','b','pass'),edge('b','w','branch-0')]};assert.equal(workflowGraphSchema.safeParse(graph).success,true);
  for(const id of ['tp','sl'])assert.equal(workflowGraphSchema.safeParse({...graph,steps:graph.steps.map(step=>step.id===id?{...step,data:{...step.data,orderType:'limit'}}:step)}).success,false);
  // Original condition default is deliberately invalid until its positive level is configured.
  assert.equal(workflowGraphSchema.safeParse({...graph,steps:graph.steps.map(step=>step.id==='c'?{...step,data:{conditionType:'price-above',value:0}}:step)}).success,false);
});
test('graph validator accepts all eight core nodes and rejects unsafe topology/configuration',()=>{
  const graph={steps:[node('t','trigger'),node('m','market-order',buy),node('l','limit-order',{...buy,priceMode:'offset-percent',priceValue:-1}),node('p','take-profit',{triggerMode:'percent',triggerValue:5,sizePercent:100,orderType:'market'}),node('s','stop-loss',{triggerMode:'absolute',triggerValue:80,sizePercent:100,orderType:'market'}),node('c','condition',{conditionType:'percent-change',value:-3}),node('b','split',{branches:2}),node('w','wait',{duration:100000,unit:'hours'})],edges:[edge('t','m'),edge('m','l'),edge('l','p'),edge('l','s'),edge('m','c'),edge('c','b','pass'),edge('b','w')]};
  assert.equal(workflowGraphSchema.safeParse(graph).success,true);
  assert.equal(workflowGraphSchema.safeParse({...graph,edges:[...graph.edges,edge('w','m')]}).success,false);
  assert.equal(workflowGraphSchema.safeParse({...graph,steps:[...graph.steps,node('orphan','trigger')]}).success,false);
  assert.equal(workflowGraphSchema.safeParse({...graph,edges:[...graph.edges,edge('absent','m')]}).success,false);
});
test('persisted waits remain independent; join waits for all parent paths; no replay',async()=>{
  const graph=workflowGraphSchema.parse({steps:[node('t','trigger'),node('b','split',{branches:2}),node('w','wait',{duration:72,unit:'hours'}),node('fast','market-order',buy),node('join','market-order',buy)],edges:[edge('t','b'),edge('b','w','branch-0'),edge('b','fast','branch-1'),edge('w','join'),edge('fast','join')]});
  let state=createGraphState(graph,input);let clock=1000;const submitted:string[]=[];
  const callbacks=():GraphCallbacks=>({now:clock,market:async()=>market,active:()=>true,save:()=>{},submit:async(id)=>{assert.equal(state.nodes[id].status,'submitting');submitted.push(id);return {status:'executed',fillPrice:'102',fillSize:'9.99'};}});
  await tickWorkflowGraph(graph,input,state,callbacks());assert.deepEqual(submitted,['fast']);assert.equal(state.nodes.w.dueAt,259201000);
  state=JSON.parse(JSON.stringify(state));clock=259201000;await tickWorkflowGraph(graph,input,state,callbacks());assert.deepEqual(submitted,['fast','join']);await tickWorkflowGraph(graph,input,state,callbacks());assert.equal(submitted.length,2);
});
test('fresh signed condition branches, joins, offset prices and percentage sizing use exact decimals',async()=>{
  const graph=workflowGraphSchema.parse({steps:[node('t','trigger'),node('c','condition',{conditionType:'percent-change',value:-3}),node('pass','limit-order',{...buy,size:33.33,priceMode:'offset-percent',priceValue:-1}),node('fail','market-order',buy),node('j','market-order',buy)],edges:[edge('t','c'),edge('c','pass','pass'),edge('c','fail','fail'),edge('pass','j'),edge('fail','j')]});
  const state=createGraphState(graph,{...input,size:'10.01'});let reads=0;const orders:OrderDraft[]=[];
  await tickWorkflowGraph(graph,input,state,{now:0,active:()=>true,market:async()=>({...market,price:reads++===0?'100':'96'}),save:()=>{},submit:async(_id,order)=>{orders.push(order);return {status:'executed',fillSize:order.size};}});
  assert.equal(state.nodes.fail.status,'skipped');assert.equal(state.nodes.j.status,'executed');assert.equal(orders[0].price,'95.04');assert.equal(orders[0].size,'3.33');
});
test('accepted entry blocks protective exits until observed fill; short TP and SL reverse correctly',async()=>{
  const graph=workflowGraphSchema.parse({steps:[node('t','trigger'),node('m','market-order',buy),node('tp','take-profit',{triggerMode:'percent',triggerValue:5,sizePercent:50,orderType:'market'}),node('sl','stop-loss',{triggerMode:'percent',triggerValue:3,sizePercent:50,orderType:'market'})],edges:[edge('t','m'),edge('m','tp'),edge('m','sl')]});
  const state=createGraphState(graph,input);const orders:OrderDraft[]=[];let filled=false;
  const callbacks:GraphCallbacks={now:0,active:()=>true,market:async()=>market,save:()=>{},submit:async(id,order)=>{orders.push(order);return id==='m'?{status:'waiting-fill',orderId:'entry'}:{status:'executed'};},reconcile:async()=>filled?{status:'executed',fillSize:'8',fillPrice:'120'}:{status:'waiting-fill'}};
  const leveraged={...input,side:'sell' as const,leverage:3,marginMode:'cross' as const};
  await tickWorkflowGraph(graph,leveraged,state,callbacks);assert.equal(orders.length,1);assert.equal(orders[0].leverage,3);filled=true;await tickWorkflowGraph(graph,leveraged,state,callbacks);assert.equal(orders.length,3);assert.equal(orders[1].trigger?.triggerPrice,'114');assert.equal(orders[2].trigger?.triggerPrice,'123.6');assert.equal(orders[1].size,'4');assert.equal(orders[1].side,'buy');assert.equal(orders[1].reduceOnly,true);for(const order of orders.slice(1)){assert.equal('leverage' in order,false);assert.equal('marginMode' in order,false);}
});
test('native OCO siblings submit together and uncertainty blocks all descendants without replay',async()=>{
  const graph=workflowGraphSchema.parse({oco:true,steps:[node('t','trigger'),node('tp','take-profit',{triggerMode:'percent',triggerValue:5,sizePercent:100,orderType:'market'}),node('sl','stop-loss',{triggerMode:'percent',triggerValue:3,sizePercent:100,orderType:'market'}),node('after','market-order',buy)],edges:[edge('t','tp'),edge('t','sl'),edge('tp','after')]});
  const state=createGraphState(graph,input);let calls=0;
  const callbacks:GraphCallbacks={now:0,active:()=>true,market:async()=>market,save:()=>{},submit:async()=>{throw new Error('No standalone order allowed');},submitBracket:async(ids,orders)=>{calls++;for(const id of ids)assert.equal(state.nodes[id].status,'submitting');assert.deepEqual(orders.map(order=>order.trigger?.triggerType),['tp','sl']);for(const order of orders){assert.equal('leverage' in order,false);assert.equal('marginMode' in order,false);}throw new Error('Uncertain native acknowledgment');}};
  const leveraged={...input,leverage:3,marginMode:'cross' as const};
  await tickWorkflowGraph(graph,leveraged,state,callbacks);await tickWorkflowGraph(graph,leveraged,state,callbacks);assert.equal(calls,1);assert.equal(state.nodes.tp.status,'unverified');assert.equal(state.nodes.sl.status,'unverified');assert.equal(state.nodes.after.status,'skipped');
  assert.equal(workflowGraphSchema.safeParse({...graph,steps:graph.steps.filter(step=>step.id!=='sl'),edges:graph.edges.filter(edge=>edge.target!=='sl')}).success,false);
  assert.equal(workflowGraphSchema.safeParse({...graph,steps:[...graph.steps,node('secondSl','stop-loss',{triggerMode:'percent',triggerValue:4,sizePercent:100,orderType:'market'})],edges:[...graph.edges,edge('t','secondSl')]}).success,false);
  assert.equal(workflowGraphSchema.safeParse({...graph,steps:graph.steps.map(step=>step.id==='sl'?{...step,data:{...step.data,sizePercent:50}}:step)}).success,false);
});
test('native OCO pairs parallel Split outputs while exclusive condition outputs cannot pair',async()=>{
  const exits=[node('tp','take-profit',{triggerMode:'percent',triggerValue:5,sizePercent:100,orderType:'market'}),node('sl','stop-loss',{triggerMode:'percent',triggerValue:3,sizePercent:100,orderType:'market'})];
  const graph=workflowGraphSchema.parse({oco:true,steps:[node('t','trigger'),node('split','split',{branches:2}),...exits],edges:[edge('t','split'),edge('split','tp','branch-0'),edge('split','sl','branch-1')]});
  const state=createGraphState(graph,input);let brackets=0;
  const callbacks:GraphCallbacks={now:0,active:()=>true,market:async()=>market,save:()=>{},submit:async()=>{throw new Error('Standalone exit forbidden');},submitBracket:async(ids)=>{brackets++;assert.deepEqual(ids,['tp','sl']);return {status:'executed',orderId:'group'};}};
  await tickWorkflowGraph(graph,input,state,callbacks);assert.equal(brackets,1);assert.equal(state.nodes.tp.status,'executed');assert.equal(state.nodes.sl.status,'executed');
  assert.equal(workflowGraphSchema.safeParse({oco:true,steps:[node('t','trigger'),node('condition','condition',{conditionType:'price-above',value:100}),...exits],edges:[edge('t','condition'),edge('condition','tp','pass'),edge('condition','sl','fail')]}).success,false);
});
test('fixed amounts and prices fail on venue precision instead of silently changing approved terms',async()=>{
  for(const orderNode of [node('o','market-order',{side:'buy',sizeMode:'absolute',size:1.001}),node('o','limit-order',{side:'buy',sizeMode:'absolute',size:1,priceMode:'absolute',priceValue:99.999}),node('o','take-profit',{triggerMode:'absolute',triggerValue:110.001,sizePercent:100,orderType:'market'}),node('o','stop-loss',{triggerMode:'percent',triggerValue:3,sizePercent:100,orderType:'limit',limitPrice:95.001})]){
    const graph=workflowGraphSchema.parse({steps:[node('t','trigger'),orderNode],edges:[edge('t','o')]});const state=createGraphState(graph,input);let submissions=0;
    await tickWorkflowGraph(graph,input,state,{now:0,active:()=>true,market:async()=>market,save:()=>{},submit:async()=>{submissions++;return {status:'executed'};}});
    assert.equal(submissions,0);assert.equal(state.nodes.o.status,'failed');assert.match(state.nodes.o.error??'',/violates exchange precision/);
  }
});
test('Hyperliquid entry and protective exits are journalled and submitted once as one native bracket',async()=>{
  const graph=workflowGraphSchema.parse({oco:true,steps:[node('t','trigger'),node('entry','limit-order',{...buy,priceMode:'absolute',priceValue:98}),node('split','split',{branches:2}),node('tp','take-profit',{triggerMode:'percent',triggerValue:5,sizePercent:100,orderType:'market'}),node('sl','stop-loss',{triggerMode:'percent',triggerValue:3,sizePercent:100,orderType:'market'})],edges:[edge('t','entry'),edge('entry','split'),edge('split','tp','branch-0'),edge('split','sl','branch-1')]});
  const hlInput={...input,venue:'hyperliquid' as const};const state=createGraphState(graph,hlInput);let brackets=0;let filled=false;
  const callbacks:GraphCallbacks={now:0,active:()=>true,market:async()=>({...market,venue:'hyperliquid'}),save:()=>{},submit:async()=>{throw new Error('Standalone entry or exit forbidden');},submitEntryBracket:async(ids,orders)=>{brackets++;for(const id of ids)assert.equal(state.nodes[id].status,'submitting');assert.equal(orders[0].price,'98');assert.equal(orders[1].trigger?.triggerPrice,'102.9');assert.equal(orders[2].trigger?.triggerPrice,'95.06');return {status:'waiting-fill',entryOrderId:'entry-id',orderId:'bracket-group'};},reconcile:async()=>filled?{status:'executed',fillSize:'10',fillPrice:'98'}:{status:'waiting-fill'}};
  await tickWorkflowGraph(graph,hlInput,state,callbacks);assert.equal(brackets,1);assert.equal(state.nodes.entry.status,'waiting-fill');assert.equal(state.nodes.entry.orderId,'entry-id');assert.equal(state.nodes.tp.status,'executed');assert.equal(state.nodes.sl.status,'executed');
  filled=true;await tickWorkflowGraph(graph,hlInput,state,callbacks);assert.equal(brackets,1);assert.equal(state.nodes.split.status,'executed');
});
test('Hyperliquid invalid OCO topology fails before any entry order is sent',async()=>{
  const graph=workflowGraphSchema.parse({oco:true,steps:[node('t','trigger'),node('entry','market-order',buy),node('wait','wait',{duration:1,unit:'minutes'}),node('tp','take-profit',{triggerMode:'percent',triggerValue:5,sizePercent:100,orderType:'market'}),node('sl','stop-loss',{triggerMode:'percent',triggerValue:3,sizePercent:100,orderType:'market'})],edges:[edge('t','entry'),edge('entry','wait'),edge('wait','tp'),edge('wait','sl')]});
  const hlInput={...input,venue:'hyperliquid' as const};const state=createGraphState(graph,hlInput);let submits=0;
  await assert.rejects(tickWorkflowGraph(graph,hlInput,state,{now:0,active:()=>true,market:async()=>market,save:()=>{},submit:async()=>{submits++;return {status:'executed'};}}),/cannot contain waits/);assert.equal(submits,0);
  assert.throws(()=>hyperliquidOcoTopology({...graph,steps:graph.steps.filter(step=>step.id!=='entry')}),/existing-position OCO requires a new entry/);
});
test('Hyperliquid finite graphs permit separate native entry brackets across parallel or delayed branches',async()=>{
  const steps=[node('t','trigger'),node('fork','split',{branches:2}),node('wait','wait',{duration:1,unit:'hours'})];const edges=[edge('t','fork'),edge('fork','wait','branch-1')];
  for(const id of ['a','b']){steps.push(node(id,'market-order',buy),node(id+'tp','take-profit',{triggerMode:'percent',triggerValue:5,sizePercent:100,orderType:'market'}),node(id+'sl','stop-loss',{triggerMode:'percent',triggerValue:3,sizePercent:100,orderType:'market'}));edges.push(edge(id==='a'?'fork':'wait',id,id==='a'?'branch-0':undefined),edge(id,id+'tp'),edge(id,id+'sl'));}
  const graph=workflowGraphSchema.parse({oco:true,steps,edges});assert.equal(hyperliquidOcoTopologies(graph).length,2);
  const hlInput={...input,venue:'hyperliquid' as const};const state=createGraphState(graph,hlInput);const submitted:string[]=[];
  const callbacks:GraphCallbacks={now:0,active:()=>true,market:async()=>({...market,venue:'hyperliquid'}),save:()=>{},submit:async()=>{throw new Error('Standalone entries forbidden');},submitEntryBracket:async(ids)=>{submitted.push(ids[0]);return {status:'executed',orderId:ids[0]+'group',fillSize:'10',fillPrice:'100'};}};
  await tickWorkflowGraph(graph,hlInput,state,callbacks);assert.deepEqual(submitted,['a']);await tickWorkflowGraph(graph,hlInput,state,{...callbacks,now:3600000});assert.deepEqual(submitted,['a','b']);
  const parallel=workflowGraphSchema.parse({...graph,steps:graph.steps.filter(step=>step.id!=='wait'),edges:[...graph.edges.filter(edge=>edge.source!=='wait'&&edge.target!=='wait'),edge('fork','b','branch-1')]});const parallelState=createGraphState(parallel,hlInput);submitted.length=0;await tickWorkflowGraph(parallel,hlInput,parallelState,callbacks);assert.deepEqual(submitted,['a','b']);
  assert.throws(()=>hyperliquidOcoTopologies({...graph,steps:graph.steps.map(step=>step.id==='atp'?{...step,data:{...step.data,sizePercent:50}}:step)}),/100%/);
});
