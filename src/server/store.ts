import { DatabaseSync } from 'node:sqlite';
import Decimal from 'decimal.js';
import type { AuditEvent, Proposal, TradingMode, Venue } from '../shared/types.ts';
import type { SyncEntries } from './sync-state.ts';

export class DeskStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, mode TEXT NOT NULL, day TEXT NOT NULL, amount TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS terminal_requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, proposalId TEXT);
      CREATE TABLE IF NOT EXISTS venue_operations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, result TEXT);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, action TEXT NOT NULL, proposalId TEXT, detail TEXT NOT NULL);`);
    this.db.exec("UPDATE venue_operations SET state='unknown' WHERE state='submitting'");
    const interrupted = this.db.prepare("SELECT body FROM proposals WHERE json_extract(body, '$.status') = 'submitting'").all();
    for (const row of interrupted) {
        const proposal = JSON.parse(String(row.body)) as Proposal;
        proposal.status = 'unknown';
        proposal.error = 'Service restarted during submission. Reconcile with the exchange before taking further action.';
        this.save(proposal, 'submission-interrupted');
    }
  }

  close(): void { this.db.close(); }
  nativeTwapRiskAllowed(account:string,revision:string|null):boolean {
    if(!revision||this.connectionFingerprint(account,'hyperliquid')!==revision)return false;
    return this.db.prepare('SELECT value FROM settings WHERE key=?').get('native-twap-risk:'+account+':'+revision)?.value==='true';
  }
  setNativeTwapRiskAllowed(account:string,revision:string,enabled:boolean):void {
    if(this.connectionFingerprint(account,'hyperliquid')!==revision)throw new Error('Reviewed connection changed');
    this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('native-twap-risk:'+account+':'+revision,String(enabled));
    this.record('native-twap-risk-updated',null,account+':'+enabled);
  }
  connectionFingerprint(account:string,venue:Venue):string|null {
    const value=this.db.prepare('SELECT value FROM settings WHERE key=?').get('connection-fingerprint:'+account+':'+venue)?.value;
    return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:null;
  }
  setConnectionFingerprint(account:string,venue:Venue,value:string|null):void {
    const key='connection-fingerprint:'+account+':'+venue;
    if(value===null){this.db.prepare('DELETE FROM settings WHERE key=?').run(key);return;}
    if(!/^[a-f0-9]{64}$/.test(value))throw new Error('Invalid verified connection fingerprint');
    this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
  }
  syncEntries():SyncEntries {
    return Object.fromEntries(this.db.prepare('SELECT key,value,updatedAt FROM sync_state').all().map(row=>[String(row.key),{value:JSON.parse(String(row.value)),updatedAt:Number(row.updatedAt)}]));
  }
  mergeSyncEntries(entries:SyncEntries):SyncEntries {
    const merged={...this.syncEntries()};
    for(const [key,entry] of Object.entries(entries))if(!merged[key]||entry.updatedAt>merged[key].updatedAt)merged[key]=entry;
    if(Object.keys(merged).length>500||Buffer.byteLength(JSON.stringify(merged))>2_000_000)throw new Error('Saved sync state exceeds its limit');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const save=this.db.prepare('INSERT INTO sync_state(key,value,updatedAt) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt WHERE excluded.updatedAt > sync_state.updatedAt');
      for(const [key,entry] of Object.entries(entries))save.run(key,JSON.stringify(entry.value),entry.updatedAt);
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
    return this.syncEntries();
  }
  operation(id:string): {state:string;result:unknown}|null {
    const row=this.db.prepare('SELECT state,result FROM venue_operations WHERE id = ?').get(id);
    return row?{state:String(row.state),result:typeof row.result==='string'?JSON.parse(row.result):null}:null;
  }
  operations(limit=200):Array<{id:string;state:string;result:unknown}> {
    if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('Operation read limit must be between 1 and 500');
    return this.db.prepare('SELECT id,state,result FROM venue_operations ORDER BY rowid DESC LIMIT ?').all(limit).map(row=>({id:String(row.id),state:String(row.state),result:typeof row.result==='string'?JSON.parse(row.result):null}));
  }
  claimOperation(id:string,fingerprint:string): {state:string;result:unknown}|null {
    const row=this.db.prepare('SELECT fingerprint,state,result FROM venue_operations WHERE id = ?').get(id);
    if (row) {
      if (row.fingerprint!==fingerprint) throw new Error('Request key belongs to a different exchange operation');
      return {state:String(row.state),result:typeof row.result==='string'?JSON.parse(row.result):null};
    }
    this.db.prepare("INSERT INTO venue_operations(id,fingerprint,state) VALUES (?,?,'submitting')").run(id,fingerprint);
    return null;
  }
  finishOperation(id:string,state:'completed'|'unknown',result:unknown):void {
    this.db.prepare('UPDATE venue_operations SET state=?, result=? WHERE id=?').run(state,JSON.stringify(result),id);
    this.record('exchange-operation-'+state,null,id);
  }
  venueMode(venue:Venue):TradingMode|null {
    const value=this.db.prepare('SELECT value FROM settings WHERE key = ?').get('venue-mode:'+venue)?.value;
    return value==='live' || value==='paper'?value:null;
  }
  setVenueMode(venue:Venue,mode:TradingMode):void {
    this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('venue-mode:'+venue,mode);
    this.record('venue-mode-updated',null,venue+':'+mode);
  }
  claimTerminal(id: string, fingerprint: string): string | null {
    const existing = this.db.prepare('SELECT fingerprint, proposalId FROM terminal_requests WHERE id = ?').get(id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('Request key belongs to a different order');
      if (typeof existing.proposalId !== 'string') throw new Error('Request is in progress or was interrupted; inspect the audit before preparing a new order');
      return existing.proposalId;
    }
    this.db.prepare('INSERT INTO terminal_requests (id, fingerprint) VALUES (?, ?)').run(id, fingerprint);
    return null;
  }
  bindTerminal(id: string, proposalId: string): void {
    this.db.prepare('UPDATE terminal_requests SET proposalId = ? WHERE id = ?').run(proposalId, id);
  }
  get(id: string): Proposal {
    const row = this.db.prepare('SELECT body FROM proposals WHERE id = ?').get(id);
    if (!row || typeof row.body !== 'string') throw new Error('Proposal not found');
    return JSON.parse(row.body) as Proposal;
  }
  list(): Proposal[] {
    return this.db.prepare('SELECT body FROM proposals ORDER BY rowid DESC LIMIT 500').all()
      .map((row) => JSON.parse(String(row.body)) as Proposal);
  }
  save(proposal: Proposal, action: string): void {
    this.db.prepare('INSERT INTO proposals (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(proposal.id, JSON.stringify(proposal));
    this.record(action, proposal.id, proposal.error ?? proposal.status);
  }
  record(action: string, id: string | null, detail: string): void {
    this.db.prepare('INSERT INTO audit (timestamp, action, proposalId, detail) VALUES (?, ?, ?, ?)')
      .run(Date.now(), action, id, detail);
  }
  audit(): AuditEvent[] {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all().map((row) => ({
      id: Number(row.id), timestamp: Number(row.timestamp), action: String(row.action),
      proposalId: row.proposalId === null ? null : String(row.proposalId), detail: String(row.detail),
    }));
  }
  get halted(): boolean { return this.db.prepare("SELECT value FROM settings WHERE key = 'halted'").get()?.value === 'true'; }
  set halted(value: boolean) {
    this.db.prepare("INSERT INTO settings VALUES ('halted', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(value));
    this.record(value ? 'execution-halted' : 'execution-resumed', null, 'Existing exchange orders are not cancelled by this switch.');
  }
  used(mode: TradingMode, day: string): string {
    const rows = this.db.prepare('SELECT amount FROM reservations WHERE mode = ? AND day = ?').all(mode, day);
    return rows.reduce((sum, row) => sum.plus(String(row.amount)), new Decimal(0)).toFixed();
  }
  reserveOperation(id:string,mode:TradingMode,day:string,amount:string,limit:string|null):void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous=this.db.prepare('SELECT amount FROM reservations WHERE id=?').get('operation:'+id);
      if (previous) {
        if (String(previous.amount)!==amount) throw new Error('Request key belongs to a different amendment');
      } else {
        if (limit !== null && new Decimal(this.used(mode,day)).plus(amount).gt(limit)) throw new Error('Daily notional limit exceeded');
        this.db.prepare('INSERT INTO reservations VALUES (?,?,?,?)').run('operation:'+id,mode,day,amount);
      }
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  reserve(id: string, mode: TradingMode, day: string, amount: string, limit: string | null): Proposal {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const proposal = this.get(id);
      if (proposal.status !== 'pending') throw new Error('Only pending proposals can be approved');
      if (this.halted) throw new Error('Execution is halted');
      if (limit !== null && new Decimal(this.used(mode, day)).plus(amount).gt(limit)) throw new Error('Daily notional limit exceeded');
      this.db.prepare('INSERT INTO reservations VALUES (?, ?, ?, ?)').run(id, mode, day, amount);
      proposal.status = 'submitting';
      proposal.estimatedNotional = amount;
      this.save(proposal, 'approval-reserved');
      this.db.exec('COMMIT');
      return proposal;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
