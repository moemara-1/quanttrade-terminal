import { z } from 'zod';
import type { Venue } from '../shared/types.ts';

const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Enter a valid wallet address');
const ethereumKey=z.string().regex(/^(?:0x)?[0-9a-fA-F]{64}$/, 'Enter a valid API wallet private key');
const lighterKey=z.string().regex(/^(?:0x)?[0-9a-fA-F]{64,128}$/, 'Enter a valid Lighter API private key').refine(value=>value.replace(/^0x/,'').length%2===0,'API private key must contain whole bytes');
const schemas={
  hyperliquid:z.object({hyperliquid_perpetual_mode:z.literal('api_wallet').default('api_wallet'),use_vault:z.literal(false).default(false),hyperliquid_perpetual_address:address,hyperliquid_perpetual_secret_key:ethereumKey}).strict(),
  lighter:z.object({lighter_perpetual_l1_address:address,lighter_perpetual_api_key_index:z.number().int().min(4).max(254),lighter_perpetual_api_private_key:lighterKey,lighter_perpetual_account_limit:z.enum(['Standard','Premium','Plus','Builder'])}).strict(),
};
export function parseCredentials(venue:Venue,input:unknown) {
  const result=schemas[venue].safeParse(input);
  if (!result.success) throw new Error('Invalid exchange credentials. Check the wallet address, API key format and required fields.');
  return result.data;
}
