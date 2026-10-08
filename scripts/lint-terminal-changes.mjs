import {execFileSync} from 'node:child_process';
const cwd='upstream/pairlens';
const list=(args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim().split('\n');
const files=[...new Set([...list(['diff','--name-only','HEAD']),...list(['ls-files','--others','--exclude-standard'])])].filter(p=>p.startsWith('apps/terminal/src/')&&/\.(ts|tsx)$/.test(p)&&!p.endsWith('routeTree.gen.ts'));
console.log(`Linting ${files.length} changed terminal files`);
execFileSync(process.execPath,['node_modules/eslint/bin/eslint.js',...files],{cwd,stdio:'inherit'});
