import Decimal from 'decimal.js';
import {z} from 'zod';
import type {Market,OrderDraft} from '../shared/types.ts';

const number=z.number().finite();
const side=z.enum(['buy','sell','inherit','opposite']);
const sizing={side,sizeMode:z.enum(['absolute','percent']),size:number.positive()};
const exit={triggerMode:z.enum(['percent','absolute']),triggerValue:number.positive(),sizePercent:number.min(1).max(100),orderType:z.enum(['market','limit']),limitPrice:number.nonnegative().optional()};
const dataSchemas={
  trigger:z.object({}),'market-order':z.object(sizing),'limit-order':z.object({...sizing,priceMode:z.enum(['absolute','offset-percent','offset-absolute']),priceValue:number}),
  'take-profit':z.object(exit),'stop-loss':z.object(exit),
  condition:z.object({conditionType:z.enum(['price-above','price-below','percent-change']),value:number}),
  split:z.object({branches:number.int().min(2).max(8)}),wait:z.object({duration:number.positive(),unit:z.enum(['seconds','minutes','hours'])}),
};
function parentSignature(graph:{steps:Array<{id:string;type:string}>;edges:Array<{source:string;target:string;sourceHandle?:string}>},id:string):string{
  // Split output handles identify parallel siblings, whereas condition handles identify exclusive paths.
  return graph.edges.filter(edge=>edge.target===id).map(edge=>`${edge.source}:${graph.steps.find(step=>step.id===edge.source)?.type==='condition'?(edge.sourceHandle??'pass'):''}`).sort().join('|');
}
export const workflowGraphSchema=z.object({oco:z.boolean().optional(),steps:z.array(z.object({id:z.string().min(1).max(100),type:z.enum(['trigger','market-order','limit-order','take-profit','stop-loss','condition','split','wait']),data:z.record(z.unknown()),position:z.object({x:number,y:number}).optional()}).strict()).min(1),edges:z.array(z.object({id:z.string().min(1),source:z.string(),target:z.string(),sourceHandle:z.string().optional()}).strict())}).strict().superRefine((graph,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message});
  const ids=new Set(graph.steps.map(step=>step.id));
  if(ids.size!==graph.steps.length)issue('Duplicate workflow node IDs');
  if(new Set(graph.edges.map(edge=>edge.id)).size!==graph.edges.length)issue('Duplicate workflow edge IDs');
  const triggers=graph.steps.filter(step=>step.type==='trigger');
  if(triggers.length!==1)issue('Workflow requires exactly one trigger');
  for(const step of graph.steps){
    if(!dataSchemas[step.type].safeParse(step.data).success)issue(`Invalid ${step.type} configuration: ${step.id}`);
    if(step.type==='condition'&&(step.data.conditionType==='percent-change'?step.data.value===0:Number(step.data.value)<=0))issue('Condition value is invalid');
    if(step.type==='limit-order'&&step.data.priceMode==='absolute'&&Number(step.data.priceValue)<=0)issue('Absolute limit price must be positive');
    if(['take-profit','stop-loss'].includes(step.type)&&step.data.orderType==='limit'&&!(Number(step.data.limitPrice)>0))issue('Protective limit price is required');
  }
  const indegree=new Map(graph.steps.map(step=>[step.id,0]));
  for(const edge of graph.edges){if(!ids.has(edge.source)||!ids.has(edge.target)){issue('Dangling workflow edge');continue;}indegree.set(edge.target,indegree.get(edge.target)!+1);
    const source=graph.steps.find(step=>step.id===edge.source)!;
    if(source.type==='condition'&&edge.sourceHandle!==undefined&&!['pass','fail'].includes(edge.sourceHandle))issue('Condition edge requires pass or fail handle');
    if(source.type==='split'&&edge.sourceHandle!==undefined&&!Array.from({length:Number(source.data.branches)},(_,i)=>`branch-${i}`).includes(edge.sourceHandle))issue('Unknown split branch');
  }
  if(triggers.length===1&&indegree.get(triggers[0].id)!>0)issue('Trigger cannot have parents');
  const queue=[...indegree].filter(([,count])=>count===0).map(([id])=>id);let visited=0;
  for(let i=0;i<queue.length;i++){visited++;for(const edge of graph.edges.filter(edge=>edge.source===queue[i])){const count=(indegree.get(edge.target)??0)-1;indegree.set(edge.target,count);if(count===0)queue.push(edge.target);}}
  if(visited!==graph.steps.length)issue('Workflow contains a cycle');
  if(triggers.length===1){const reachable=new Set([triggers[0].id]);for(let changed=true;changed;){changed=false;for(const edge of graph.edges)if(reachable.has(edge.source)&&!reachable.has(edge.target)){reachable.add(edge.target);changed=true;}}if(graph.steps.some(step=>!reachable.has(step.id)))issue('Workflow contains unreachable nodes');}
  if(graph.oco){
    const exits=graph.steps.filter(step=>['take-profit','stop-loss'].includes(step.type));
    if(!exits.length)issue('OCO requires paired protective exits');
    for(const step of exits){const parents=parentSignature(graph,step.id);const matches=exits.filter(other=>other.id!==step.id&&other.type!==step.type&&other.data.sizePercent===step.data.sizePercent&&parentSignature(graph,other.id)===parents);if(matches.length!==1)issue('OCO requires one matching TP/SL sibling with identical parents and close percentage');}
  }
});
export type WorkflowGraph=z.infer<typeof workflowGraphSchema>;
export type GraphNodeState={status:'pending'|'waiting'|'waiting-fill'|'submitting'|'executed'|'skipped'|'failed'|'unverified';effectiveSize:string;entryPrice:string;dueAt?:number;orderId?:string;error?:string;passed?:boolean};
export type GraphExecutionState={nodes:Record<string,GraphNodeState>};
export type GraphOrderResult={status:'executed'|'waiting-fill'|'unverified';orderId?:string;entryOrderId?:string;fillPrice?:string;fillSize?:string;error?:string};
export type GraphCallbacks={now:number;market:()=>Promise<Market>;submit:(nodeId:string,order:OrderDraft)=>Promise<GraphOrderResult>;submitBracket?:(nodeIds:[string,string],orders:[OrderDraft,OrderDraft])=>Promise<GraphOrderResult>;submitEntryBracket?:(nodeIds:[string,string,string],orders:[OrderDraft,OrderDraft,OrderDraft])=>Promise<GraphOrderResult>;reconcile?:(nodeId:string,orderId:string)=>Promise<GraphOrderResult>;save:()=>Promise<void>|void;active:()=>boolean};
export function createGraphState(graph:WorkflowGraph,input:OrderDraft):GraphExecutionState{return {nodes:Object.fromEntries(graph.steps.map(step=>[step.id,{status:'pending',effectiveSize:input.size,entryPrice:'0'}]))};}
const terminal=(state:GraphNodeState)=>['executed','skipped','failed','unverified'].includes(state.status);
function normalizedPrice(value:Decimal,market:Market,exact=false):string{let price=value.toDecimalPlaces(market.priceDecimals,Decimal.ROUND_HALF_UP);if(market.venue==='hyperliquid'&&!price.isInteger())price=price.toSignificantDigits(5,Decimal.ROUND_HALF_UP);if(price.lte(0))throw new Error('Computed workflow price is not positive');if(exact&&!price.eq(value))throw new Error('Fixed workflow price violates exchange precision; revise the reviewed price');return price.toFixed();}
/** Hyperliquid's verified OCO path is one native entry-attached bracket, never a guessed position bracket. */
export type HyperliquidOcoTopology={entry:string;tp:string;sl:string;split?:string};
export function hyperliquidOcoTopologies(graph:WorkflowGraph):HyperliquidOcoTopology[]{
  const tps=graph.steps.filter(step=>step.type==='take-profit');const sls=graph.steps.filter(step=>step.type==='stop-loss');
  const groups:HyperliquidOcoTopology[]=[];const usedSl=new Set<string>();const usedEntry=new Set<string>();
  if(!tps.length)throw new Error('Hyperliquid OCO requires a new entry and a TP/SL pair; existing-position OCO is not supported');
  for(const tp of tps){
    const matches=sls.filter(sl=>parentSignature(graph,sl.id)===parentSignature(graph,tp.id));
    if(matches.length!==1||usedSl.has(matches[0].id))throw new Error('Hyperliquid OCO requires uniquely paired protective siblings');
    const sl=matches[0];usedSl.add(sl.id);
    if(tp.data.sizePercent!==100||sl.data.sizePercent!==100)throw new Error('Verified Hyperliquid entry-attached OCO requires both exits to protect 100% of the entry');
    const parents=graph.edges.filter(edge=>edge.target===tp.id);const other=graph.edges.filter(edge=>edge.target===sl.id);
    if(parents.length!==1||other.length!==1||parents[0].source!==other[0].source)throw new Error('Hyperliquid OCO exits must be direct siblings of their entry or one Split');
    const source=graph.steps.find(step=>step.id===parents[0].source);let entry=source;let split:string|undefined;
    if(source?.type==='split'){const incoming=graph.edges.filter(edge=>edge.target===source.id);entry=incoming.length===1?graph.steps.find(step=>step.id===incoming[0].source):undefined;split=source.id;}
    if(!entry||(entry.type!=='market-order'&&entry.type!=='limit-order'))throw new Error('Hyperliquid native OCO cannot contain waits or conditions between entry and protective exits; existing-position OCO requires a new entry');
    if(usedEntry.has(entry.id))throw new Error('A Hyperliquid entry cannot own multiple native OCO pairs');usedEntry.add(entry.id);
    groups.push({entry:entry.id,tp:tp.id,sl:sl.id,...(split?{split}:{})});
  }
  if(usedSl.size!==sls.length)throw new Error('Hyperliquid OCO contains an orphan stop-loss');return groups;
}
export function hyperliquidOcoTopology(graph:WorkflowGraph):HyperliquidOcoTopology{const groups=hyperliquidOcoTopologies(graph);if(groups.length!==1)throw new Error('Expected one Hyperliquid OCO group');return groups[0];}
function attachedExit(step:WorkflowGraph['steps'][number],entry:OrderDraft,market:Market):OrderDraft{
  const reference=new Decimal(entry.price??market.price);const value=new Decimal(String(step.data.triggerValue));const gain=(step.type==='take-profit')===(entry.side==='buy');const trigger=step.data.triggerMode==='absolute'?value:reference.mul(new Decimal(1).plus(value.div(100).mul(gain?1:-1)));
  const size=new Decimal(entry.size).mul(String(step.data.sizePercent)).div(100).toDecimalPlaces(market.sizeDecimals,Decimal.ROUND_DOWN).toFixed();
  const order:OrderDraft={venue:entry.venue,symbol:entry.symbol,marketType:entry.marketType,side:entry.side==='buy'?'sell':'buy',type:step.data.orderType==='limit'?'limit':'market',size,sizeUnit:'base',reduceOnly:true,rationale:`Workflow ${step.id}: native entry-attached ${step.type}`,trigger:{triggerType:step.type==='take-profit'?'tp':'sl',triggerPrice:normalizedPrice(trigger,market,step.data.triggerMode==='absolute')}};
  if(order.type==='limit')order.price=normalizedPrice(new Decimal(String(step.data.limitPrice)),market,true);return order;
}
/** Durable DAG tick: waits never block unrelated branches, and submission is journalled first. */
export async function tickWorkflowGraph(graph:WorkflowGraph,input:OrderDraft,state:GraphExecutionState,callbacks:GraphCallbacks):Promise<void>{
  const attachedGroups=graph.oco&&input.venue==='hyperliquid'?hyperliquidOcoTopologies(graph):[];
  for(let changed=true;changed&&callbacks.active();){changed=false;
    for(const step of graph.steps){
      if(!callbacks.active())return;
      const node=state.nodes[step.id];if(terminal(node)||node.status==='submitting')continue;
      if(node.status==='waiting-fill'){
        if(!callbacks.reconcile||!node.orderId)continue;
        const result=await callbacks.reconcile(step.id,node.orderId);node.status=result.status;node.error=result.error;if(result.fillSize)node.effectiveSize=result.fillSize;if(result.fillPrice)node.entryPrice=result.fillPrice;await callbacks.save();if(result.status==='waiting-fill')continue;changed=true;
        // Newly resolved fills propagate on the next pass, never submit again.
        continue;
      }
      const incoming=graph.edges.filter(edge=>edge.target===step.id);
      if(node.status==='pending'){
        if(incoming.some(edge=>!terminal(state.nodes[edge.source])))continue;
        const live=incoming.filter(edge=>{const parent=state.nodes[edge.source];return parent.status==='executed'&&(parent.passed===undefined||(edge.sourceHandle==='fail'?!parent.passed:parent.passed));});
        if(step.type!=='trigger'&&!live.length){node.status='skipped';node.error='All parent paths skipped or failed';await callbacks.save();changed=true;continue;}
        if(live.length){const parent=state.nodes[live[live.length-1].source];node.effectiveSize=parent.effectiveSize;node.entryPrice=parent.entryPrice;}
      }
      try{
        if(step.type==='wait'){
          if(node.dueAt===undefined){const duration=new Decimal(String(step.data.duration)).mul(step.data.unit==='hours'?3600000:step.data.unit==='minutes'?60000:1000);const due=new Decimal(callbacks.now).plus(duration);if(due.gt(Number.MAX_SAFE_INTEGER))throw new Error('Wait exceeds supported timestamp range');node.dueAt=due.toNumber();node.status='waiting';await callbacks.save();}
          if(node.dueAt>callbacks.now)continue;node.status='executed';await callbacks.save();changed=true;continue;
        }
        if(step.type==='split'){node.status='executed';await callbacks.save();changed=true;continue;}
        const market=await callbacks.market();if(!callbacks.active())return;
        const price=new Decimal(market.price);if(!price.isFinite()||price.lte(0))throw new Error('Fresh positive workflow price is required');
        if(step.type==='trigger'){node.entryPrice=price.toFixed();node.status='executed';await callbacks.save();changed=true;continue;}
        if(step.type==='condition'){
          const value=new Decimal(String(step.data.value));const reference=new Decimal(node.entryPrice).gt(0)?new Decimal(node.entryPrice):price;
          node.passed=step.data.conditionType==='price-above'?price.gt(value):step.data.conditionType==='price-below'?price.lt(value):value.gte(0)?price.minus(reference).div(reference).mul(100).gte(value):price.minus(reference).div(reference).mul(100).lte(value);
          node.status='executed';await callbacks.save();changed=true;continue;
        }
        const protective=step.type==='take-profit'||step.type==='stop-loss';
        if(protective&&input.marketType==='spot')throw new Error('Spot protective trigger orders are not verified for this connector');
        const amount=protective?new Decimal(node.effectiveSize).mul(String(step.data.sizePercent)).div(100):step.data.sizeMode==='absolute'?new Decimal(String(step.data.size)):new Decimal(node.effectiveSize).mul(String(step.data.size)).div(100);
        const size=amount.toDecimalPlaces(market.sizeDecimals,Decimal.ROUND_DOWN).toFixed();if(new Decimal(size).lte(0))throw new Error('Workflow size rounds to zero');if(!protective&&step.data.sizeMode==='absolute'&&!amount.eq(size))throw new Error('Fixed workflow size violates exchange precision; revise the reviewed size');
        const selected=step.data.side;const orderSide=protective||selected==='opposite'?(input.side==='buy'?'sell':'buy'):selected==='buy'||selected==='sell'?selected:input.side;
        const {price:unusedPrice,trigger:unusedTrigger,quoteBudget:unusedBudget,...base}=input;
        const order:OrderDraft={...base,side:orderSide,size,sizeUnit:'base',type:step.type==='limit-order'||(protective&&step.data.orderType==='limit')?'limit':'market',postOnly:step.type==='limit-order'?input.postOnly:false,reduceOnly:protective?true:input.reduceOnly,rationale:`Workflow ${step.id}: ${step.type}`};
        // Protect the observed position; exits must never alter its leverage or margin mode.
        if(protective){delete order.leverage;delete order.marginMode;}
        if(step.type==='limit-order'){const value=new Decimal(String(step.data.priceValue));order.price=normalizedPrice(step.data.priceMode==='absolute'?value:step.data.priceMode==='offset-percent'?price.mul(new Decimal(1).plus(value.div(100))):price.plus(value),market,step.data.priceMode==='absolute');}
        if(protective){const reference=new Decimal(node.entryPrice).gt(0)?new Decimal(node.entryPrice):price;const gain=(step.type==='take-profit')===(input.side==='buy');const value=new Decimal(String(step.data.triggerValue));const trigger=step.data.triggerMode==='absolute'?value:reference.mul(new Decimal(1).plus(value.div(100).mul(gain?1:-1)));order.trigger={triggerType:step.type==='take-profit'?'tp':'sl',triggerPrice:normalizedPrice(trigger,market,step.data.triggerMode==='absolute')};if(order.type==='limit')order.price=normalizedPrice(new Decimal(String(step.data.limitPrice)),market,true);}
        const attached=attachedGroups.find(group=>group.entry===step.id);
        if(attached){
          if(!callbacks.submitEntryBracket)throw new Error('Hyperliquid native entry bracket execution is unavailable');
          const tpState=state.nodes[attached.tp],slState=state.nodes[attached.sl];if(tpState.status!=='pending'||slState.status!=='pending')throw new Error('Native entry bracket protective nodes are not pending');
          const tp=attachedExit(graph.steps.find(item=>item.id===attached.tp)!,order,market),sl=attachedExit(graph.steps.find(item=>item.id===attached.sl)!,order,market);
          node.status='submitting';tpState.status='submitting';slState.status='submitting';await callbacks.save();if(!callbacks.active())return;
          const result=await callbacks.submitEntryBracket([step.id,attached.tp,attached.sl],[order,tp,sl]);
          node.status=result.status;node.orderId=result.entryOrderId??(result.status==='waiting-fill'?undefined:result.orderId);node.error=result.error;if(result.fillSize)node.effectiveSize=result.fillSize;if(result.fillPrice)node.entryPrice=result.fillPrice;
          if(result.status==='waiting-fill'&&!result.entryOrderId){node.status='unverified';node.error='Native bracket entry acknowledgment has no entry order ID';}
          for(const exitState of [tpState,slState]){exitState.status=node.status==='unverified'?'unverified':'executed';exitState.orderId=result.orderId;exitState.effectiveSize=tp.size;exitState.entryPrice=order.price??market.price;exitState.error=node.error;}
          await callbacks.save();changed=true;continue;
        }
        let sibling:GraphNodeState|undefined;
        let siblingId:string|undefined;
        let siblingOrder:OrderDraft|undefined;
        if(protective&&graph.oco){
          if(!callbacks.submitBracket)throw new Error('Native OCO execution is unavailable');
          const parents=parentSignature(graph,step.id);
          const pairs=graph.steps.filter(other=>other.type===(step.type==='take-profit'?'stop-loss':'take-profit')&&other.data.sizePercent===step.data.sizePercent&&parentSignature(graph,other.id)===parents);
          if(pairs.length!==1)throw new Error('OCO pairing is ambiguous or incomplete');
          const paired=pairs[0];
          siblingId=paired.id;sibling=state.nodes[paired.id];if(sibling.status!=='pending')throw new Error('OCO sibling is not pending');
          const reference=new Decimal(node.entryPrice).gt(0)?new Decimal(node.entryPrice):price;
          const gain=(paired.type==='take-profit')===(input.side==='buy');const value=new Decimal(String(paired.data.triggerValue));const trigger=paired.data.triggerMode==='absolute'?value:reference.mul(new Decimal(1).plus(value.div(100).mul(gain?1:-1)));
          siblingOrder={...order,type:paired.data.orderType==='limit'?'limit':'market',rationale:`Workflow ${paired.id}: ${paired.type}`,trigger:{triggerType:paired.type==='take-profit'?'tp':'sl',triggerPrice:normalizedPrice(trigger,market,paired.data.triggerMode==='absolute')}};
          if(siblingOrder.type==='limit')siblingOrder.price=normalizedPrice(new Decimal(String(paired.data.limitPrice)),market,true);else delete siblingOrder.price;
          sibling.effectiveSize=node.effectiveSize;sibling.entryPrice=node.entryPrice;sibling.status='submitting';
        }
        node.status='submitting';await callbacks.save();if(!callbacks.active())return;
        const result=sibling&&siblingId&&siblingOrder?await callbacks.submitBracket!([step.id,siblingId],[order,siblingOrder]):await callbacks.submit(step.id,order);node.status=result.status;node.orderId=result.orderId;node.error=result.error;if(result.fillSize)node.effectiveSize=result.fillSize;if(result.fillPrice)node.entryPrice=result.fillPrice;
        if(sibling){sibling.status=result.status;sibling.orderId=result.orderId;sibling.error=result.error;}
        await callbacks.save();changed=true;
      }catch(error){node.status=node.status==='submitting'?'unverified':'failed';node.error=error instanceof Error?error.message:'Workflow step failed';for(const pending of Object.values(state.nodes))if(pending.status==='submitting'){pending.status='unverified';pending.error=node.error;}await callbacks.save();changed=true;}
    }
  }
}
