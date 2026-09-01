import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HEALTH='http://127.0.0.1:4096/global/health';
const BRIDGE_URL='https://ryo-nd.com/visualizer/model-lab-bridge.mjs';
const bridgePath=path.join(os.tmpdir(),'ai-visualizer-model-lab-bridge.mjs');

async function probe(){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),1500);
  try{
    const response=await fetch(HEALTH,{cache:'no-store',signal:controller.signal});
    const payload=await response.json().catch(()=>null);
    return response.ok&&payload?.healthy?payload:null;
  }catch{return null}finally{clearTimeout(timer)}
}

async function portListening(){
  const net=await import('node:net');
  return new Promise(resolve=>{
    const socket=net.createConnection({host:'127.0.0.1',port:4096});
    const done=value=>{socket.destroy();resolve(value)};
    socket.setTimeout(1200);
    socket.once('connect',()=>done(true));
    socket.once('timeout',()=>done(false));
    socket.once('error',()=>done(false));
  });
}

const existing=await probe();
if(existing){
  console.log('');
  console.log('AI Visualizer Model Lab is ALREADY RUNNING on http://127.0.0.1:4096');
  console.log(`Service: ${existing.bridge||'OpenCode-compatible'}${existing.version?` · ${existing.version}`:''}`);
  console.log('No second bridge is needed. Go to ryo-nd.com/visualizer → Model → Local Model Lab → Connect.');
  console.log('');
  process.exit(0);
}

if(await portListening()){
  console.error('');
  console.error('Port 4096 is already occupied by something that is NOT responding as Model Lab.');
  console.error('Run these PowerShell commands to identify it:');
  console.error("  $c=Get-NetTCPConnection -LocalPort 4096 -State Listen | Select-Object -First 1");
  console.error("  $p=Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\"");
  console.error('  $p | Select-Object ProcessId,Name,CommandLine');
  console.error('Do not kill it blindly; paste that output into ChatGPT.');
  console.error('');
  process.exit(1);
}

console.log('Downloading the latest AI Visualizer Model Lab bridge…');
const response=await fetch(BRIDGE_URL,{cache:'no-store'});
if(!response.ok)throw new Error(`Could not download Model Lab bridge (HTTP ${response.status}).`);
fs.writeFileSync(bridgePath,Buffer.from(await response.arrayBuffer()));
console.log('Starting Model Lab…');
await import(`${new URL(`file:///${bridgePath.replaceAll('\\','/')}`).href}?t=${Date.now()}`);
