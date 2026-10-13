import { z } from 'zod';
// Disabled limits are explicit nulls; turnover remains recorded even when uncapped.
export const notionalLimit = z.union([z.literal('off'), z.string().regex(/^[1-9]\d*(?:\.\d+)?$/)]).default('off').transform(value => value === 'off' ? null : value);
