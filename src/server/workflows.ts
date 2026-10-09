import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { orderSchema, type TradingDesk } from './trading.ts';

const positive=z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value=>new Decimal(value).gt(0));
export const workflowPlanSchema=z.object({
  name:z.string().min(1).max(100),accountName:z.string().min(1).max(100),
  mode:z.enum(['paper','live']),maxTotalNotional:positive,
  steps:z.array(z.object({delaySeconds:z.number().int().min(0).max(172800),order:orderSchema}).strict()).min(1).max(20),
}).strict().superRefine((plan,ctx)=>{
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
type StepState={status:'pending'|'submitting'|'submitted'|'simulated'|'unverified';proposalId?:string;orderId?:string;error?:string};
export type WorkflowRun={id:string;fingerprint:string;plan:WorkflowPlan;startedAt:number;spent:string;status:'active'|'completed'|'paused'|'cancelled';states:StepState[];error?:string};

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
    if(input.plan.accountName!==this.desk.status().accountName)throw new Error('Reviewed workflow account no longer matches the execution account');
    if(this.desk.modeFor(input.plan.steps[0].order.venue)!==input.plan.mode)throw new Error('Reviewed workflow mode no longer matches the exchange');
    if(this.list().filter(run=>run.status==='active').length>=20)throw new Error('Too many active workflows');
    let total=new Decimal(0);
    const revision=this.connectionRevision;
    for(const step of input.plan.steps)total=total.plus((await this.desk.preview(step.order)).notional);
    if(revision!==this.connectionRevision||this.desk.modeFor(input.plan.steps[0].order.venue)!==input.plan.mode)throw new Error('Exchange credentials or mode changed during approval; prepare a fresh plan');
    if(total.gt(input.plan.maxTotalNotional))throw new Error('Reviewed workflow budget does not cover its protected order notionals');
    const run:WorkflowRun={id:input.clientOrderId,fingerprint,plan:input.plan,startedAt:this.clock(),spent:'0',status:'active',states:input.plan.steps.map(()=>({status:'pending'}))};
    // Preview awaits network reads: check for a concurrent confirmation before saving.
    const duplicate=this.db.prepare('SELECT body FROM workflow_runs WHERE id=?').get(run.id);
    if(duplicate){const stored=JSON.parse(String(duplicate.body)) as WorkflowRun;if(stored.fingerprint!==fingerprint)throw new Error('Approval ID belongs to a different workflow plan');return stored;}
    if(this.list().filter(item=>item.status==='active').length>=20)throw new Error('Too many active workflows');
    this.save(run);return run;
  }
  cancel(id:string):WorkflowRun {const run=this.get(id);run.status='cancelled';run.error='Future workflow steps cancelled. Existing exchange orders and positions are unchanged.';this.save(run);return run;}
  pauseVenue(venue:string):void {this.connectionRevision++;for(const run of this.list().filter(item=>item.status==='active'&&item.plan.steps[0].order.venue===venue)){run.status='paused';run.error='Exchange credentials changed; prepare and approve a fresh plan.';this.save(run);}}
  async tick():Promise<void> {
    if(this.busy||this.closing)return;
    this.busy=true;
    try {
      for(const candidate of this.list().filter(run=>run.status==='active')) {
        if(this.closing)break;
        const run=this.get(candidate.id);
        const index=run.states.findIndex(state=>state.status==='pending');
        if(index<0){run.status='completed';this.save(run);continue;}
        const step=run.plan.steps[index];
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
