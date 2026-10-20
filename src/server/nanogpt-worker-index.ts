import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createNanoGptWorker } from './nanogpt-worker.ts';
import { NanoGptJobs } from './nanogpt-jobs.ts';

const token = readFileSync(resolve('data', 'operator-token'), 'utf8').trim();
const worker = createNanoGptWorker(token,new NanoGptJobs(fetch,event=>console.info('Inference job',JSON.stringify(event))));
const server = worker.app.listen(4319, '127.0.0.1', () => console.log('QuantTrade inference worker listening on loopback'));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  worker.drain();
  const finish = () => {
    // Keep completed bytes through the normal resume window too. Provider
    // completion alone does not prove the browser received its tool arguments.
    if (worker.jobs.retainedCount !== 0) return false;
    worker.close();
    server.close(() => process.exit(0));
    return true;
  };
  if (finish()) return;
  const timer = setInterval(() => { if (finish()) clearInterval(timer); }, 250);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
server.on('error', () => { console.error('Inference worker could not start'); worker.close(); process.exitCode = 1; });
