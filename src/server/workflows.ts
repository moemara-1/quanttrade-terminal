import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { orderSchema, type TradingDesk } from './trading.ts';
import {workflowGraphSchema,validateWorkflowInput,hyperliquidOcoTopologies,createGraphState,tickWorkflowGraph,type GraphExecutionState,type GraphNodeState,type GraphOrderResult} from './workflow-graph.ts';
import type {OrderDraft} from '../shared/types.ts';

const positive=z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value=>new Decimal(value).gt(0));
export const workflowPlanSchema=z.object({
  name:z.string().min(1).max(100),accountName:z.string().min(1).max(100),
  mode:z.enum(['paper','live']),maxTotalNotional:positive,
  steps:z.array(z.object({delaySeconds:z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER/1000)),order:orderSchema}).strict()).min(1).optional(),
  graph:workflowGraphSchema.optional(),input:orderSchema.optional(),
}).strict().superRefine((plan,ctx)=>{
  if(plan.graph){if(plan.steps||!plan.input||plan.input.sizeUnit==='quote'||plan.input.trigger!==undefined)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Graph plans require one exact base-sized input and explicit protective graph nodes, without scheduled steps'});return;}
  if(!plan.steps||plan.input){ctx.addIssue({code:z.ZodIssueCode.custom,message:'Use a graph with its input or scheduled exact orders'});return;}
  const first=plan.steps[0];
  let previous=-1;
  for (const step of plan.steps) {
    if (step.delaySeconds<previous) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Workflow times must be in chronological order'});
    previous=step.delaySeconds;
    if(step.order.venue!==first.order.venue || step.order.symbol!==first.order.symbol || (step.order.marketType??'perpetual')!==(first.order.marketType??'perpetual'))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'A reviewed workflow must use one exact venue and instrument'});
  }
});
export type WorkflowPlan=z.infer<typeof workflowPlanSchema>;
type StepState={status:GraphNodeState['status']|'submitted'|'simulated';nodeId?:string;proposalId?:string;order?:OrderDraft;orderId?:string;error?:string};
export type WorkflowRun={id:string;fingerprint:string;plan:WorkflowPlan;startedAt:number;spent:string;status:'active'|'completed'|'paused'|'cancelled';states:StepState[];graphState?:GraphExecutionState;graphOrders?:Record<string,OrderDraft>;error?:string};

/** Only a fresh operator confirmation registers this finite, immutable order plan. */
export class WorkflowRuns {
  private readonly db:DatabaseSync;
  private timer:ReturnType<typeof setInterval>|undefined;
  private busy=false;
  private closing=false;
  private connectionRevision=0;
  constructor(path:string,private readonly desk:TradingDesk,private readonly clock=Date.now) {
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workflow_runs (id TEXT PRIMARY KEY,body TEXT NOT NULL)');
    for(const run of this.list()) {
      if(run.states.some(state=>state.status==='submitting')) {
        run.status='paused';run.error='Service restarted during submission. Reconcile the exchange; this plan is not retried.';
        for(const state of run.states)if(state.status==='submitting')state.status='unverified';
        if(run.graphState)for(const node of Object.values(run.graphState.nodes))if(node.status==='submitting')node.status='unverified';
        this.save(run);
      }
    }
  }
  list():WorkflowRun[] {return this.db.prepare('SELECT body FROM workflow_runs').all().map(row=>JSON.parse(String(row.body)) as WorkflowRun).sort((a,b)=>b.startedAt-a.startedAt);}
  get(id:string):WorkflowRun {const row=this.db.prepare('SELECT body FROM workflow_runs WHERE id=?').get(id);if(!row)throw new Error('Workflow run not found');return JSON.parse(String(row.body)) as WorkflowRun;}
  private save(run:WorkflowRun) {this.db.prepare('INSERT INTO workflow_runs(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(run.id,JSON.stringify(run));}
  async start(raw:unknown):Promise<WorkflowRun> {
    const input=z.object({clientOrderId:z.string().min(1).max(100),proposedAt:z.number().int(),plan:workflowPlanSchema}).strict().parse(raw);
    const fingerprint=createHash('sha256').update(JSON.stringify(input.plan)).digest('hex');
    const existing=this.db.prepare('SELECT body FROM workflow_runs WHERE id=?').get(input.clientOrderId);
    if(existing){const run=JSON.parse(String(existing.body)) as WorkflowRun;if(run.fingerprint!==fingerprint)throw new Error('Approval ID belongs to a different workflow plan');return run;}
    if(input.proposedAt>this.clock()||this.clock()-input.proposedAt>180000)throw new Error('Workflow approval expired; prepare a fresh plan');
    if(this.desk.status().halted)throw new Error('Execution is halted');
    if(input.plan.graph&&input.plan.input)validateWorkflowInput(input.plan.graph,input.plan.input);
    if(input.plan.graph?.oco&&input.plan.input?.venue==='hyperliquid')hyperliquidOcoTopologies(input.plan.graph);
    if(input.plan.accountName!==this.desk.status().accountName)throw new Error('Reviewed workflow account no longer matches the execution account');
    if(this.desk.modeFor((input.plan.input??input.plan.steps![0].order).venue)!==input.plan.mode)throw new Error('Reviewed workflow mode no longer matches the exchange');
    if(this.list().filter(run=>run.status==='active').length>=20)throw new Error('Too many active workflows');
    let total=new Decimal(0);
    const revision=this.connectionRevision;
    for(const step of input.plan.steps??[])total=total.plus((await this.desk.preview(step.order)).notional);
    if(input.plan.input)await this.desk.currentMarket(input.plan.input);
    if(revision!==this.connectionRevision||this.desk.modeFor((input.plan.input??input.plan.steps![0].order).venue)!==input.plan.mode)throw new Error('Exchange credentials or mode changed during approval; prepare a fresh plan');
    if(total.gt(input.plan.maxTotalNotional))throw new Error('Reviewed workflow budget does not cover its protected order notionals');
    const run:WorkflowRun={id:input.clientOrderId,fingerprint,plan:input.plan,startedAt:this.clock(),spent:'0',status:'active',states:input.plan.graph?input.plan.graph.steps.map(node=>({status:'pending',nodeId:node.id})):(input.plan.steps??[]).map(()=>({status:'pending'})),...(input.plan.graph&&input.plan.input?{graphState:createGraphState(input.plan.graph,input.plan.input),graphOrders:{}}:{})};
    // Preview awaits network reads: check for a concurrent confirmation before saving.
    const duplicate=this.db.prepare('SELECT body FROM workflow_runs WHERE id=?').get(run.id);
    if(duplicate){const stored=JSON.parse(String(duplicate.body)) as WorkflowRun;if(stored.fingerprint!==fingerprint)throw new Error('Approval ID belongs to a different workflow plan');return stored;}
    if(this.list().filter(item=>item.status==='active').length>=20)throw new Error('Too many active workflows');
    this.save(run);return run;
  }
  cancel(id:string):WorkflowRun {const run=this.get(id);run.status='cancelled';run.error='Future workflow steps cancelled. Existing exchange orders and positions are unchanged.';this.save(run);return run;}
  pauseVenue(venue:string):void {this.connectionRevision++;for(const run of this.list().filter(item=>item.status==='active'&&(item.plan.input??item.plan.steps![0].order).venue===venue)){run.status='paused';run.error='Exchange connection was disconnected, reconfigured, or its trading mode changed. This does not prove your API keys changed. Check the account and approve a fresh plan.';this.save(run);}}
  private async tickGraph(run:WorkflowRun):Promise<void>{
    const graph=run.plan.graph!,input=run.plan.input!,state=run.graphState!;
    const active=()=>!this.closing&&this.get(run.id).status==='active';
    const save=()=>{const current=this.get(run.id);current.graphState=state;current.states=graph.steps.map(step=>({nodeId:step.id,status:state.nodes[step.id].status,orderId:state.nodes[step.id].orderId,error:state.nodes[step.id].error}));if(Object.values(state.nodes).some(node=>node.status==='failed'||node.status==='unverified')){if(current.status==='active')current.status='paused';current.error=Object.values(state.nodes).find(node=>node.error)?.error??'Workflow execution unverified';}this.save(current);};
    const authorization=()=>{if(this.desk.status().halted||run.plan.accountName!==this.desk.status().accountName||run.plan.mode!==this.desk.modeFor(input.venue))throw new Error('Execution halted or reviewed workflow account/mode changed');};
    const budget=async(orders:OrderDraft[])=>{authorization();let total=new Decimal(0);for(const order of orders)total=total.plus((await this.desk.preview(order)).notional);if(new Decimal(this.get(run.id).spent).plus(total).gt(run.plan.maxTotalNotional))throw new Error('Workflow exceeds its approved total notional budget');if(!active())throw new Error('Workflow is no longer active');return total;};
    const readFill=async(order:OrderDraft,id:string)=>{
      try{return await this.desk.orderEvidence(order,id,run.plan.mode);}
      catch{return {status:'pending' as const,error:'Fill verification is temporarily unavailable. Only the read will retry; this order is not resubmitted.'};}
    };
    const recordSpend=(amount:string)=>{const current=this.get(run.id);current.spent=new Decimal(current.spent).plus(amount).toFixed();this.save(current);};
    try{
      authorization();
      await tickWorkflowGraph(graph,input,state,{
        now:this.clock(),active,save,market:()=>this.desk.currentMarket(input),
        submit:async(nodeId,order):Promise<GraphOrderResult>=>{
          await budget([order]);
          const current=this.get(run.id);current.graphOrders??={};current.graphOrders[nodeId]=order;this.save(current);
          const proposal=await this.desk.confirm(`workflow:${run.id}:node:${nodeId}`,run.plan.mode,order);
          recordSpend(proposal.estimatedNotional);
          if(!['submitted','paper-open','paper-filled'].includes(proposal.status)||!proposal.orderId)return {status:'unverified',error:proposal.error??'Submission unverified'};
          if(order.trigger)return {status:'executed',orderId:proposal.orderId};
          const evidence=await readFill(order,proposal.orderId);
          return evidence.status==='filled'?{status:'executed',orderId:proposal.orderId,fillPrice:evidence.fillPrice,fillSize:evidence.fillSize}:evidence.status==='failed'?{status:'unverified',orderId:proposal.orderId,error:evidence.error}:{status:'waiting-fill',orderId:proposal.orderId,error:evidence.error};
        },
        reconcile:async(nodeId,orderId):Promise<GraphOrderResult>=>{
          authorization();const order=this.get(run.id).graphOrders?.[nodeId];if(!order)throw new Error('Persisted workflow order terms missing; do not retry');
          const evidence=await readFill(order,orderId);
          return evidence.status==='filled'?{status:'executed',orderId,fillPrice:evidence.fillPrice,fillSize:evidence.fillSize}:evidence.status==='failed'?{status:'unverified',orderId,error:evidence.error}:{status:'waiting-fill',orderId,error:evidence.error};
        },
        submitBracket:async(nodeIds,orders):Promise<GraphOrderResult>=>{
          await budget(orders);
          const id=createHash('sha256').update(`workflow:${run.id}:${nodeIds.join(':')}`).digest('hex');
          const result=await this.desk.confirmBracket(id,run.plan.mode,orders);recordSpend(result.estimatedNotional);
          return {status:result.status==='unknown'?'unverified':'executed',orderId:result.orderId,error:result.error};
        },
        submitEntryBracket:async(nodeIds,orders):Promise<GraphOrderResult>=>{
          await budget(orders);
          const current=this.get(run.id);current.graphOrders??={};current.graphOrders[nodeIds[0]]=orders[0];this.save(current);
          const id=createHash('sha256').update(`workflow:${run.id}:${nodeIds.join(':')}`).digest('hex');
          const result=await this.desk.confirmEntryBracket(id,run.plan.mode,orders);recordSpend(result.estimatedNotional);
          if(result.status==='unknown')return {status:'unverified',error:result.error};
          if(result.fillPrice&&result.fillSize)return {status:'executed',orderId:result.orderId,entryOrderId:result.entryOrderId,fillPrice:result.fillPrice,fillSize:result.fillSize};
          if(run.plan.mode==='paper'&&result.entryOrderId){const evidence=await this.desk.orderEvidence(orders[0],result.entryOrderId,'paper');if(evidence.status==='filled')return {status:'executed',orderId:result.orderId,entryOrderId:result.entryOrderId,fillPrice:evidence.fillPrice,fillSize:evidence.fillSize};}
          return {status:'waiting-fill',orderId:result.orderId,entryOrderId:result.entryOrderId};
        },
      });
      const current=this.get(run.id);if(current.status==='active'&&Object.values(state.nodes).every(node=>node.status==='executed'||node.status==='skipped')){current.status='completed';this.save(current);}
    }catch(cause){const current=this.get(run.id);if(current.status==='active')current.status='paused';current.error=cause instanceof Error?cause.message:'Workflow outcome uncertain';this.save(current);}
  }
  async tick():Promise<void> {
    if(this.busy||this.closing)return;
    this.busy=true;
    try {
      for(const candidate of this.list().filter(run=>run.status==='active')) {
        if(this.closing)break;
        const run=this.get(candidate.id);
        if(run.plan.graph){await this.tickGraph(run);continue;}
        const index=run.states.findIndex(state=>state.status==='pending');
        if(index<0){run.status='completed';this.save(run);continue;}
        const step=run.plan.steps![index];
        if(run.startedAt+step.delaySeconds*1000>this.clock())continue;
        try {
          if(this.clock()-(run.startedAt+step.delaySeconds*1000)>300000)throw new Error('Scheduled step missed by over five minutes; workflow paused rather than catching up orders');
          if(this.desk.status().halted)throw new Error('Execution is halted; workflow paused');
          if(run.plan.accountName!==this.desk.status().accountName||run.plan.mode!==this.desk.modeFor(step.order.venue))throw new Error('Reviewed account or exchange mode changed; workflow paused');
          const preview=await this.desk.preview(step.order);
          if(new Decimal(run.spent).plus(preview.notional).gt(run.plan.maxTotalNotional))throw new Error('Market moved beyond the approved total workflow budget');
          if(this.get(run.id).status!=='active')continue;
          run.states[index]={status:'submitting'};this.save(run);
          const proposal=await this.desk.confirm(`workflow:${run.id}:${index}`,run.plan.mode,step.order);
          const current=this.get(run.id);
          const accepted=proposal.status==='submitted'||proposal.status==='paper-open'||proposal.status==='paper-filled';
          current.states[index]={status:accepted?(run.plan.mode==='live'?'submitted':'simulated'):'unverified',proposalId:proposal.id,...(proposal.orderId?{orderId:proposal.orderId}:{}),...(proposal.error?{error:proposal.error}:{})};
          current.spent=new Decimal(current.spent).plus(proposal.estimatedNotional).toFixed();
          if(!accepted){current.status='paused';current.error=proposal.error??'Submission unverified; remaining steps paused';}
          else if(current.status==='active'&&current.states.every(state=>state.status==='submitted'||state.status==='simulated'))current.status='completed';
          this.save(current);
        } catch(cause) {
          const current=this.get(run.id);
          if(current.status!=='cancelled')current.status='paused';
          current.error=cause instanceof Error?cause.message:'Workflow result is unverified';
          if(current.states[index].status==='submitting')current.states[index]={status:'unverified',error:current.error};
          this.save(current);
        }
      }
    } finally {this.busy=false;if(this.closing)this.db.close();}
  }
  startTimer(){if(this.timer)return;this.timer=setInterval(()=>{void this.tick().catch(error=>console.error('Workflow scheduler error:',error instanceof Error?error.message:'unknown'));},1000);this.timer.unref();}
  close(){if(this.closing)return;this.closing=true;if(this.timer)clearInterval(this.timer);if(!this.busy)this.db.close();}
}
