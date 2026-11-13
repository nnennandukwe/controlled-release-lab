import { runHostedCommand } from '../../tools/hosted-operator-recovery.js';

const path = process.env.HOSTED_PROCESS_PID_FILE!;
const timeoutCase = process.env.HOSTED_PROCESS_CASE === 'timeout';
// Real disposable process tree: the descendant holds inherited output pipes.
const grandchild = `setInterval(() => {}, 1000);`;
const command = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)},'--',${JSON.stringify(path)}],{stdio:['ignore','inherit','inherit']});fs.writeFileSync(${JSON.stringify(path)},JSON.stringify([process.pid,child.pid]));${timeoutCase ? 'setTimeout(()=>process.exit(0),200);' : 'setInterval(()=>{},1000);'}`;
const result = await runHostedCommand(process.execPath, ['-e', command], { cwd: process.cwd(), env: process.env, timeoutMs: timeoutCase ? 1500 : 30000 });
process.stdout.write(`${JSON.stringify(result)}\n`);
