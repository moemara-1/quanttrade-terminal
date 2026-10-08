import { z } from 'zod';

export interface SyncEntry { value: unknown; updatedAt: number }
export type SyncEntries = Record<string, SyncEntry>;
const watchlistsSchema=z.object({activeListId:z.string().min(1).max(128),lists:z.array(z.object({id:z.string().min(1).max(128),name:z.string().min(1).max(200),symbols:z.array(z.string().min(1).max(512)).max(5000)}).strict()).min(1).max(100)}).strict().refine(value=>new Set(value.lists.map(list=>list.id)).size===value.lists.length&&value.lists.some(list=>list.id===value.activeListId),'Watchlists need unique IDs and a valid active list');
const keys = new Set(['hosted.watchlists','language','keybindings','theme.activePluginId','performance-mode','trade-confirm-mode','terminal.market','terminal.timeframe','terminal.chartType','terminal.crosshairMode','terminal.priceScaleMode','terminal.drawingToolMode','terminal.drawingFavorites','terminal.orderbookMetric','copilot.persona','pair-picker.assetClass','pair-picker.category','pair-picker.viewMode','pair-picker.recent','pair-picker.assetClassMap','region.okx','region.binance','region.bybit','discovery.sectionOrder','terminal.indicators','terminal.drawings','custom-workspaces','terminal.layout','discovery.layout','memecoins.board']);
export function isSyncKey(key:string):boolean {
  return keys.has(key)||/^(?:drawing-last-[A-Za-z0-9_.-]+|terminal\.(?:chartType|layout)\.[A-Za-z0-9_-]+|discovery\.layout\.[A-Za-z0-9_-]+|workspace\.[A-Za-z0-9_-]+\.layout|workspace-vars:[A-Za-z0-9_-]+|pair-picker\.assetClass\.[A-Za-z0-9_-]+)$/.test(key);
}
function hasSecrets(value:unknown,depth=0):boolean {
  if(depth>32)return true;
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,item])=>/^(?:api[_-]?key|private[_-]?key|secret|password|operator[_-]?token|access[_-]?token|authorization)$/i.test(key)||hasSecrets(item,depth+1));
}
export function validateSyncEntries(raw:unknown):SyncEntries {
  const entries=z.record(z.string().max(160),z.object({value:z.unknown(),updatedAt:z.number().int().nonnegative().max(Date.now()+5000)}).strict()).parse(raw);
  if(Object.keys(entries).length>500)throw new Error('Too many sync entries');
  if(Buffer.byteLength(JSON.stringify(entries))>500_000)throw new Error('Sync payload is too large');
  for(const [key,entry] of Object.entries(entries)) {
    if(key==='hosted.watchlists')watchlistsSchema.parse(entry.value);
    if(!Object.hasOwn(entry,'value')||!isSyncKey(key)||hasSecrets(entry.value))throw new Error('Sync accepts only supported settings, charts and workspace data');
  }
  return Object.fromEntries(Object.entries(entries).map(([key,entry])=>[key,{value:entry.value,updatedAt:entry.updatedAt}]));
}
