#!/usr/bin/env bash
set -euo pipefail
umask 077
previous=$(readlink -f /opt/quanttrade/current)
release=/opt/quanttrade/releases/20261020-5
[[ "$previous" == /opt/quanttrade/releases/20261020-4 ]]
[[ ! -e "$release" ]]
mkdir "$release"
tar -C "$previous" --exclude='./node_modules' --exclude='./upstream' --exclude='./frontend' -cf - . | tar -C "$release" -xf -
ln -s "$previous/node_modules" "$release/node_modules"
ln -s "$previous/frontend" "$release/frontend"
tar -xzf /opt/quanttrade/inference-worker-source.tar.gz -C "$release"
python3 - "$release" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
path = root/'src/server/app.ts'
text = path.read_text()
replacements = [
    ("import {NanoGptJobs,NanoGptJobError} from './nanogpt-jobs.ts';", "import {NanoGptJobs,NanoGptJobError} from './nanogpt-jobs.ts';\nimport type {NanoGptJobService} from './nanogpt-worker.ts';"),
    ('nanogptJobs?:NanoGptJobs;', 'nanogptJobs?:NanoGptJobService;'),
    ("app.post('/api/ai/nanogpt/jobs',inferenceOperator,express.json({limit:'2mb'}),(req,res)=>{", "app.post('/api/ai/nanogpt/jobs',inferenceOperator,express.json({limit:'2mb'}),async(req,res)=>{"),
    ('id:nanogptJobs.start(', 'id:await nanogptJobs.start('),
    ('const response=nanogptJobs.read(', 'const response=await nanogptJobs.read('),
    ("app.delete('/api/ai/nanogpt/jobs/:id',inferenceOperator,(req,res)=>{try{nanogptJobs.cancel(", "app.delete('/api/ai/nanogpt/jobs/:id',inferenceOperator,async(req,res)=>{try{await nanogptJobs.cancel("),
]
for before, after in replacements:
    assert text.count(before) == 1, 'Unexpected inference integration source'
    text = text.replace(before, after)
path.write_text(text)
path = root/'src/server/index.ts'
text = path.read_text()
before = "import { LlmArena } from './llm-arena.ts';"
assert text.count(before) == 1
text = text.replace(before, before + "\nimport { NanoGptWorkerClient } from './nanogpt-worker.ts';")
before = 'const app=createApp({arena,'
assert text.count(before) == 1
text = text.replace(before, "const app=createApp({nanogptJobs:new NanoGptWorkerClient('http://127.0.0.1:4319',token('operator-token')),arena,")
path.write_text(text)
PY
chmod a+rx "$release"
chmod -R a+rX "$release/src" "$release/tests" "$release/deployment"
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
cd "$release"
runuser -u quanttrade -- node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
restore(){ ln -sfn "$previous" /opt/quanttrade/current; systemctl restart quanttrade-bridge; }
trap restore ERR
ln -sfn "$release" /opt/quanttrade/current
install -m 0644 deployment/quanttrade-inference.service /etc/systemd/system/quanttrade-inference.service
mkdir -p /etc/systemd/system/quanttrade-bridge.service.d
printf '[Unit]\nAfter=quanttrade-inference.service\nWants=quanttrade-inference.service\n' > /etc/systemd/system/quanttrade-bridge.service.d/inference.conf
systemctl daemon-reload
systemctl enable --now quanttrade-inference
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4319/health
systemctl restart quanttrade-bridge
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4318/api/health
python3 deployment/verify-background-ai.py
python3 deployment/verify-public.py
trap - ERR
printf '\nIsolated inference worker active: %s; exchange service unchanged.\n' "$release"
