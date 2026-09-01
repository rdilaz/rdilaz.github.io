const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function bridgeRuntime() {
  'use strict';

  const CHANNEL = 'visualizer-sandbox-v1';
  const HOST_CHANNEL = 'visualizer-host-v1';
  const startedAt = performance.now();
  const MAX_MESSAGES = 24;
  const samplePoints = [[.08,.08],[.5,.08],[.92,.08],[.08,.5],[.5,.5],[.92,.5],[.08,.92],[.5,.92],[.92,.92]];
  const trackedContexts = new Map();
  const qualityListeners = new Set();
  const frameListeners = new Set();
  const pendingVisualSamples = [];

  let currentFrame = {
    version: 'visualizer-audio-v1', time: 0, deltaTime: 0,
    audio: {
      connected: false, silence: true, volume: 0, peak: 0, transient: 0, beat: 0,
      tempo: 0, tempoConfidence: 0, spectralFlux: 0, spectralCentroid: 0,
      bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 },
      stereo: { balance: 0, width: 0 }, waveform: Array(128).fill(0), spectrum: Array(96).fill(0),
    },
    pointer: { x: .5, y: .5, active: false, down: false },
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 },
  };
  let viewport = currentFrame.viewport;
  let runtimeState = {
    targetFps: 60,
    quality: 1,
    renderScale: 1,
    capabilities: {
      canvas2d: true,
      webgl: Boolean(document.createElement('canvas').getContext('webgl')),
      webgl2: Boolean(document.createElement('canvas').getContext('webgl2')),
      webgpu: Boolean(navigator.gpu),
    },
  };

  const diag = {
    ready: false, readyAt: 0, hostFrames: 0, vizFrameReads: 0, vizSubscriptions: 0, cssVizBindings: 0,
    rafCallbacks: 0, rafIntervals: [], lastRafAt: 0, heartbeats: 0, domMutations: 0,
    canvas2dOps: 0, webglDrawCalls: 0, webgpuSubmits: 0, contexts: [], errors: [], warnings: [],
    consoleErrors: [], consoleWarnings: [], cspViolations: [], shaderErrors: [], programErrors: [],
    contextLosses: [], webgpuErrors: [], visualSamples: [], lastVisualSignature: '', visualChanges: 0, lastSampleAt: 0,
  };

  function compact(value, max = 420) {
    let text = '';
    try { text = typeof value === 'string' ? value : value instanceof Error ? (value.stack || value.message) : JSON.stringify(value); }
    catch { text = String(value); }
    return text.length > max ? text.slice(0, max) + '…' : text;
  }
  function keep(list, value) { list.push(value); if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES); }
  function post(type, payload = {}) { parent.postMessage({ channel: CHANNEL, type, at: performance.now() - startedAt, ...payload }, '*'); }
  function diagnostic(code, message, { fatal = false, severity = fatal ? 'fatal' : 'warning', detail = '' } = {}) {
    const entry = { code, message: compact(message, 500), detail: compact(detail, 900), fatal, severity, at: performance.now() - startedAt };
    if (fatal) keep(diag.errors, entry); else keep(diag.warnings, entry);
    post('diagnostic', entry); return entry;
  }

  const nativeConsoleError = console.error.bind(console), nativeConsoleWarn = console.warn.bind(console);
  console.error = (...args) => { const message = args.map(value => compact(value, 220)).join(' '); keep(diag.consoleErrors, { message, at: performance.now() - startedAt }); post('console', { level: 'error', message }); nativeConsoleError(...args); };
  console.warn = (...args) => { const message = args.map(value => compact(value, 220)).join(' '); keep(diag.consoleWarnings, { message, at: performance.now() - startedAt }); post('console', { level: 'warn', message }); nativeConsoleWarn(...args); };

  addEventListener('error', event => { const message = event.message || 'Visualizer runtime error'; diagnostic('RUNTIME_ERROR', message, { fatal: true, detail: event.error && (event.error.stack || event.error.message) }); post('error', { code: 'RUNTIME_ERROR', message }); });
  addEventListener('unhandledrejection', event => { const message = compact(event.reason || 'Unhandled rejection', 500); diagnostic('UNHANDLED_REJECTION', message, { fatal: true }); post('error', { code: 'UNHANDLED_REJECTION', message }); });
  addEventListener('securitypolicyviolation', event => { const entry = { directive: event.violatedDirective || '', blocked: compact(event.blockedURI || '', 240), at: performance.now() - startedAt }; keep(diag.cspViolations, entry); post('diagnostic', { code: 'CSP_VIOLATION', severity: 'warning', fatal: false, message: `${entry.directive}: ${entry.blocked || 'blocked resource'}` }); });

  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  const wrappedWebgl = new WeakSet();
  function recordContext(canvas, type, context) {
    if (!context) return context;
    if (!trackedContexts.has(canvas)) trackedContexts.set(canvas, []);
    const records = trackedContexts.get(canvas);
    if (!records.some(record => record.context === context)) { records.push({ type, context }); diag.contexts.push(type); if (diag.contexts.length > 12) diag.contexts.shift(); }
    if (/^webgl2?$/.test(type)) wrapWebgl(canvas, context, type);
    return context;
  }
  function wrapWebgl(canvas, gl, type) {
    if (wrappedWebgl.has(gl)) return; wrappedWebgl.add(gl);
    canvas.addEventListener('webglcontextlost', event => { keep(diag.contextLosses, { type, at: performance.now() - startedAt }); diagnostic('WEBGL_CONTEXT_LOST', `${type} context was lost.`, { fatal: true }); post('error', { code: 'WEBGL_CONTEXT_LOST', message: `${type} context was lost.` }); if (event?.preventDefault) event.preventDefault(); });
    const nativeCompileShader = gl.compileShader.bind(gl);
    gl.compileShader = shader => { nativeCompileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(shader) || 'Shader compilation failed without a driver log.'; const entry = { type, log: compact(log, 1200), at: performance.now() - startedAt }; keep(diag.shaderErrors, entry); diagnostic('SHADER_COMPILE_FAILED', entry.log, { fatal: true, detail: type }); post('error', { code: 'SHADER_COMPILE_FAILED', message: entry.log }); } };
    const nativeLinkProgram = gl.linkProgram.bind(gl);
    gl.linkProgram = program => { nativeLinkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(program) || 'WebGL program link failed without a driver log.'; const entry = { type, log: compact(log, 1200), at: performance.now() - startedAt }; keep(diag.programErrors, entry); diagnostic('PROGRAM_LINK_FAILED', entry.log, { fatal: true, detail: type }); post('error', { code: 'PROGRAM_LINK_FAILED', message: entry.log }); } };
    for (const methodName of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) { if (typeof gl[methodName] !== 'function') continue; const nativeMethod = gl[methodName].bind(gl); gl[methodName] = (...args) => { diag.webglDrawCalls += 1; return nativeMethod(...args); }; }
  }
  HTMLCanvasElement.prototype.getContext = function(type, ...args) { return recordContext(this, String(type || '').toLowerCase(), nativeGetContext.call(this, type, ...args)); };

  if (typeof CanvasRenderingContext2D !== 'undefined') {
    for (const name of ['fillRect','strokeRect','clearRect','drawImage','fill','stroke','fillText','strokeText','putImageData']) {
      const nativeMethod = CanvasRenderingContext2D.prototype[name]; if (typeof nativeMethod !== 'function' || nativeMethod.__vizWrapped) continue;
      const wrapped = function(...args) { diag.canvas2dOps += 1; return nativeMethod.apply(this, args); }; wrapped.__vizWrapped = true; try { CanvasRenderingContext2D.prototype[name] = wrapped; } catch {}
    }
  }

  if (typeof GPUAdapter !== 'undefined' && GPUAdapter.prototype && typeof GPUAdapter.prototype.requestDevice === 'function') {
    const nativeRequestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function(...args) {
      const device = await nativeRequestDevice.apply(this, args);
      try {
        device.addEventListener('uncapturederror', event => { const message = compact(event.error?.message || event.error || 'WebGPU uncaptured error', 700); keep(diag.webgpuErrors, { message, at: performance.now() - startedAt }); diagnostic('WEBGPU_UNCAPTURED_ERROR', message); });
        device.lost?.then(info => { const message = compact(info?.message || 'WebGPU device lost', 700); keep(diag.webgpuErrors, { message, at: performance.now() - startedAt }); diagnostic('WEBGPU_DEVICE_LOST', message, { fatal: true }); post('error', { code: 'WEBGPU_DEVICE_LOST', message }); });
        if (device.queue && typeof device.queue.submit === 'function') { const nativeSubmit = device.queue.submit.bind(device.queue); device.queue.submit = (...submitArgs) => { diag.webgpuSubmits += 1; return nativeSubmit(...submitArgs); }; }
      } catch {}
      return device;
    };
  }

  function parseRgb(color) { const match = String(color || '').match(/rgba?\(([^)]+)\)/i); if (!match) return null; const parts = match[1].split(',').map(Number); return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: Number.isFinite(parts[3]) ? parts[3] : 1 }; }
  function pixelStats(samples) {
    if (!samples.length) return { informative: false, signature: '', range: 0, luminance: 0 };
    const channels = [[],[],[],[]]; samples.forEach(pixel => pixel.forEach((value,index) => channels[index].push(value)));
    const range = Math.max(...channels.slice(0,3).map(values => Math.max(...values) - Math.min(...values)));
    const luminance = samples.reduce((sum,[r,g,b,a]) => sum + ((.2126*r + .7152*g + .0722*b) * (a / 255)), 0) / samples.length;
    const alpha = samples.reduce((sum,pixel) => sum + pixel[3], 0) / samples.length;
    const signature = samples.map(pixel => pixel.map(value => Math.round(value / 8)).join('.')).join('|');
    return { informative: range >= 6 || luminance >= 10 || alpha < 245, signature, range, luminance };
  }
  function sampleCanvas(canvas, records) {
    const width = canvas.width || Math.round(canvas.clientWidth || 0), height = canvas.height || Math.round(canvas.clientHeight || 0); if (width < 2 || height < 2) return null;
    const rect = canvas.getBoundingClientRect(), viewportArea = Math.max(1, innerWidth * innerHeight), areaRatio = Math.max(0, Math.min(1, (Math.max(0,rect.width) * Math.max(0,rect.height)) / viewportArea));
    let stats = null, renderer = records?.[0]?.type || 'canvas';
    for (const record of records || []) {
      try {
        if (record.type === '2d') { const pixels = samplePoints.map(([nx,ny]) => Array.from(record.context.getImageData(Math.min(width-1,Math.max(0,Math.floor(nx*width))), Math.min(height-1,Math.max(0,Math.floor(ny*height))), 1, 1).data)); stats = pixelStats(pixels); renderer = '2d'; break; }
        if (/^webgl2?$/.test(record.type)) { const gl = record.context; if (gl.isContextLost?.() || gl.getParameter(gl.FRAMEBUFFER_BINDING)) continue; const pixels=[]; for (const [nx,ny] of samplePoints) { const out=new Uint8Array(4), x=Math.min(gl.drawingBufferWidth-1,Math.max(0,Math.floor(nx*gl.drawingBufferWidth))), y=Math.min(gl.drawingBufferHeight-1,Math.max(0,Math.floor(ny*gl.drawingBufferHeight))); gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out); pixels.push(Array.from(out)); } stats=pixelStats(pixels); renderer=record.type; break; }
      } catch {}
    }
    return { renderer, width, height, areaRatio, ...(stats || { informative:false, signature:'', range:0, luminance:0 }) };
  }
  function visibleDomEvidence() {
    const viewportArea=Math.max(1,innerWidth*innerHeight); let visibleArea=0,svgArea=0,meaningfulNodes=0,textChars=0,styleSignature='';
    const nodes=Array.from(document.body?.querySelectorAll('*')||[]).slice(0,180);
    for (const node of nodes) {
      if (['SCRIPT','STYLE','CANVAS'].includes(node.tagName)) continue; let style,rect; try { style=getComputedStyle(node); rect=node.getBoundingClientRect(); } catch { continue; }
      if (!rect || rect.width<=0 || rect.height<=0 || style.display==='none' || style.visibility==='hidden' || Number(style.opacity||1)<=.01) continue;
      const area=Math.max(0,Math.min(innerWidth,rect.right)-Math.max(0,rect.left))*Math.max(0,Math.min(innerHeight,rect.bottom)-Math.max(0,rect.top)); if (area<=0) continue;
      const bg=parseRgb(style.backgroundColor), text=(node.textContent||'').trim(), hasVisualStyle=(bg&&bg.a>.02&&(bg.r+bg.g+bg.b>12))||style.backgroundImage!=='none'||style.borderStyle!=='none'||style.boxShadow!=='none'||style.filter!=='none'; if (text) textChars+=Math.min(200,text.length);
      if (hasVisualStyle||text||node instanceof SVGElement) { visibleArea+=Math.min(area,viewportArea); meaningfulNodes+=1; if (node instanceof SVGElement) svgArea+=Math.min(area,viewportArea); if (styleSignature.length<1200) styleSignature+=`${node.tagName}:${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}:${style.opacity}:${style.transform}:${style.backgroundColor}:${style.color}|`; }
    }
    const animations=typeof document.getAnimations==='function'?document.getAnimations().filter(animation=>animation.playState==='running').length:0;
    return { areaRatio:Math.min(1,visibleArea/viewportArea), svgAreaRatio:Math.min(1,svgArea/viewportArea), meaningfulNodes, textChars, animations, signature:styleSignature };
  }
  function hashText(text) { let hash=2166136261; for (let i=0;i<text.length;i+=1){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);} return (hash>>>0).toString(16); }
  function collectVisualEvidence(force=false) {
    const now=performance.now(); if(!force&&now-diag.lastSampleAt<260) return pendingVisualSamples.at(-1)||null; diag.lastSampleAt=now;
    const canvases=Array.from(document.querySelectorAll('canvas')).slice(0,8).map(canvas=>sampleCanvas(canvas,trackedContexts.get(canvas)||[])).filter(Boolean), dom=visibleDomEvidence();
    const dominantCanvas=canvases.reduce((best,candidate)=>candidate.areaRatio>(best?.areaRatio||0)?candidate:best,null), canvasInformative=canvases.some(canvas=>canvas.informative), canvasSignature=canvases.map(canvas=>`${canvas.renderer}:${canvas.signature}:${canvas.width}x${canvas.height}`).join('||'), signature=hashText(`${canvasSignature}::${dom.signature}::${dom.animations}`);
    if(diag.lastVisualSignature&&signature!==diag.lastVisualSignature) diag.visualChanges+=1; diag.lastVisualSignature=signature;
    const dominantNeedsProof=Boolean(dominantCanvas&&dominantCanvas.areaRatio>=.24), substantialDom=dom.areaRatio>=.08||dom.svgAreaRatio>=.04||dom.textChars>=24, canvasActivity=diag.canvas2dOps>0||diag.webglDrawCalls>0||diag.webgpuSubmits>0, darkButChangingCanvas=canvasActivity&&diag.visualChanges>0;
    const visible=dominantNeedsProof?(canvasInformative||darkButChangingCanvas||(substantialDom&&dom.areaRatio>=.25)):(canvasInformative||darkButChangingCanvas||substantialDom);
    const sample={at:now-startedAt,signature,visible,dominantNeedsProof,canvasInformative,canvasActivity,dominantCanvas:dominantCanvas?{renderer:dominantCanvas.renderer,areaRatio:dominantCanvas.areaRatio,informative:dominantCanvas.informative,range:dominantCanvas.range,luminance:dominantCanvas.luminance,width:dominantCanvas.width,height:dominantCanvas.height}:null,canvases:canvases.map(canvas=>({renderer:canvas.renderer,areaRatio:canvas.areaRatio,informative:canvas.informative,range:canvas.range,luminance:canvas.luminance,width:canvas.width,height:canvas.height})),dom};
    pendingVisualSamples.push(sample); if(pendingVisualSamples.length>16) pendingVisualSamples.shift(); diag.visualSamples=pendingVisualSamples.slice(-8); return sample;
  }

  const nativeRaf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>nativeRaf(timestamp=>{const now=performance.now();if(diag.lastRafAt){diag.rafIntervals.push(now-diag.lastRafAt);if(diag.rafIntervals.length>180)diag.rafIntervals.shift();}diag.lastRafAt=now;diag.rafCallbacks+=1;let result;try{result=callback(timestamp);}finally{collectVisualEvidence(false);}return result;});
  function percentile(values,p){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.max(0,Math.floor((sorted.length-1)*p)))];}
  function snapshot(){const visual=collectVisualEvidence(true), recentIntervals=diag.rafIntervals.slice(-60), medianFrameMs=percentile(recentIntervals,.5),p95FrameMs=percentile(recentIntervals,.95),fps=medianFrameMs>0?Math.min(240,1000/medianFrameMs):0;return{ready:diag.ready,readyAt:diag.readyAt,uptimeMs:performance.now()-startedAt,heartbeatAgeMs:diag.lastHeartbeatAt?performance.now()-diag.lastHeartbeatAt:null,hostFrames:diag.hostFrames,vizFrameReads:diag.vizFrameReads,vizSubscriptions:diag.vizSubscriptions,cssVizBindings:diag.cssVizBindings,rafCallbacks:diag.rafCallbacks,fps,medianFrameMs,p95FrameMs,domMutations:diag.domMutations,canvas2dOps:diag.canvas2dOps,webglDrawCalls:diag.webglDrawCalls,webgpuSubmits:diag.webgpuSubmits,contexts:[...diag.contexts],errors:diag.errors.slice(-12),warnings:diag.warnings.slice(-12),consoleErrors:diag.consoleErrors.slice(-12),consoleWarnings:diag.consoleWarnings.slice(-12),cspViolations:diag.cspViolations.slice(-12),shaderErrors:diag.shaderErrors.slice(-8),programErrors:diag.programErrors.slice(-8),contextLosses:diag.contextLosses.slice(-8),webgpuErrors:diag.webgpuErrors.slice(-8),visual:{...visual,visibleEver:diag.visualSamples.some(sample=>sample.visible),informativeCanvasEver:diag.visualSamples.some(sample=>sample.canvasInformative)},visualChanges:diag.visualChanges,runtime:{...runtimeState,capabilities:{...runtimeState.capabilities}}};}

  const runtimeApi={get targetFps(){return runtimeState.targetFps},get quality(){return runtimeState.quality},get renderScale(){return runtimeState.renderScale},get capabilities(){return Object.freeze({...runtimeState.capabilities})},onQualityChange(callback){if(typeof callback!=='function')return()=>{};qualityListeners.add(callback);return()=>qualityListeners.delete(callback)}};Object.freeze(runtimeApi);
  const api={version:'visualizer-audio-v1',get frame(){diag.vizFrameReads+=1;return currentFrame},get viewport(){return viewport},runtime:runtimeApi,onFrame(callback){if(typeof callback!=='function')return()=>{};diag.vizSubscriptions+=1;frameListeners.add(callback);return()=>frameListeners.delete(callback)}};Object.freeze(api);Object.defineProperty(window,'VIZ',{value:api,configurable:false,writable:false});

  function updateCssViz(frame){const root=document.documentElement,audio=frame.audio||{},bands=audio.bands||{},stereo=audio.stereo||{},pointer=frame.pointer||{};const values={'--viz-time':frame.time||0,'--viz-delta-time':frame.deltaTime||0,'--viz-volume':audio.volume||0,'--viz-peak':audio.peak||0,'--viz-transient':audio.transient||0,'--viz-beat':audio.beat||0,'--viz-tempo':audio.tempo||0,'--viz-tempo-confidence':audio.tempoConfidence||0,'--viz-flux':audio.spectralFlux||0,'--viz-centroid':audio.spectralCentroid||0,'--viz-sub-bass':bands.subBass||0,'--viz-bass':bands.bass||0,'--viz-low-mid':bands.lowMid||0,'--viz-mid':bands.mid||0,'--viz-high-mid':bands.highMid||0,'--viz-treble':bands.treble||0,'--viz-balance':stereo.balance||0,'--viz-width':stereo.width||0,'--viz-pointer-x':pointer.x??.5,'--viz-pointer-y':pointer.y??.5,'--viz-pointer-active':pointer.active?1:0,'--viz-pointer-down':pointer.down?1:0};for(const[name,value]of Object.entries(values))root.style.setProperty(name,String(value));}
  function updateCssRuntime(){const root=document.documentElement;root.style.setProperty('--viz-quality',String(runtimeState.quality));root.style.setProperty('--viz-render-scale',String(runtimeState.renderScale));root.style.setProperty('--viz-target-fps',String(runtimeState.targetFps));}
  addEventListener('message',event=>{const message=event.data;if(!message||message.channel!==HOST_CHANNEL)return;if(message.type==='frame'){currentFrame=message.frame;viewport=message.frame.viewport||viewport;diag.hostFrames+=1;updateCssViz(currentFrame);frameListeners.forEach(listener=>{try{listener(currentFrame)}catch(error){const text=compact(error?.stack||error,700);diagnostic('VIZ_LISTENER_ERROR',text,{fatal:true});post('error',{code:'VIZ_LISTENER_ERROR',message:text});}});collectVisualEvidence(false);return;}if(message.type==='runtime'){runtimeState={...runtimeState,...message.runtime,capabilities:{...runtimeState.capabilities,...(message.runtime?.capabilities||{})}};updateCssRuntime();qualityListeners.forEach(listener=>{try{listener(Object.freeze({...runtimeState,capabilities:Object.freeze({...runtimeState.capabilities})}))}catch{}});return;}if(message.type==='diagnostic-command'&&message.command==='snapshot')post('diagnostic-snapshot',{requestId:message.requestId,snapshot:snapshot()});});
  const observer=new MutationObserver(records=>{diag.domMutations+=records.length;});
  addEventListener('DOMContentLoaded',()=>{try{observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true})}catch{}diag.cssVizBindings=Array.from(document.querySelectorAll('style')).filter(style=>/var\(\s*--viz-|--viz-(?:volume|beat|bass|treble|mid|flux|centroid|time|balance|width)/i.test(style.textContent||'')).length;updateCssViz(currentFrame);updateCssRuntime();diag.ready=true;diag.readyAt=performance.now()-startedAt;collectVisualEvidence(true);post('ready');});
  setInterval(()=>{diag.heartbeats+=1;diag.lastHeartbeatAt=performance.now();collectVisualEvidence(false);post('heartbeat',{rafCallbacks:diag.rafCallbacks,hostFrames:diag.hostFrames});},1000);
}

const BRIDGE = `<script>(${bridgeRuntime.toString()})();<\/script>`;
function injectRuntime(html){const clean=String(html||'').replace(/<base\b[^>]*>/gi,''),meta=`<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP.replaceAll('"','&quot;')}">`,baseStyle='<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050506}*{box-sizing:border-box}</style>';if(/<head[\s>]/i.test(clean))return clean.replace(/<head([^>]*)>/i,`<head$1>${meta}${baseStyle}${BRIDGE}`);if(/<html[\s>]/i.test(clean))return clean.replace(/<html([^>]*)>/i,`<html$1><head>${meta}${baseStyle}${BRIDGE}</head>`);return`<!doctype html><html><head>${meta}${baseStyle}${BRIDGE}</head><body>${clean}</body></html>`;}
export function validateVisualizerHtml(html){const value=String(html||'').trim(),problems=[];if(value.length<120)problems.push('The returned HTML is too short to be a visualizer.');if(value.length>350000)problems.push('The returned HTML exceeds the 350 KB visualizer limit.');if(!/<(?:!doctype\s+html|html)[\s>]/i.test(value))problems.push('Return one complete HTML document.');if(/\b(?:src|href)\s*=\s*["']https?:/i.test(value))problems.push('External assets are unavailable; make the visualizer fully self-contained.');return problems;}
export class VisualizerSandbox{constructor(iframe,onEvent=()=>{}){this.iframe=iframe;this.onEvent=onEvent;this.errors=[];this.events=[];this.ready=false;this.lastHeartbeatAt=0;this.snapshotRequests=new Map;this.messageHandler=event=>{if(event.source!==this.iframe.contentWindow)return;const message=event.data;if(!message||message.channel!=='visualizer-sandbox-v1')return;this.events.push(message);if(this.events.length>100)this.events.shift();if(message.type==='ready')this.ready=true;if(message.type==='heartbeat')this.lastHeartbeatAt=performance.now();if(message.type==='error'||(message.type==='diagnostic'&&message.fatal)){this.errors.push({code:message.code||'RUNTIME_ERROR',message:String(message.message||'Visualizer error'),at:message.at||0});if(this.errors.length>30)this.errors.shift();}if(message.type==='diagnostic-snapshot'&&message.requestId){const request=this.snapshotRequests.get(message.requestId);if(request){clearTimeout(request.timer);this.snapshotRequests.delete(message.requestId);request.resolve(message.snapshot);}}this.onEvent(message,this)};window.addEventListener('message',this.messageHandler)}resetTelemetry(){this.ready=false;this.errors=[];this.events=[];this.lastHeartbeatAt=performance.now()}async load(html,{smokeTestMs=0}={}){this.resetTelemetry();this.iframe.srcdoc=injectRuntime(html);if(smokeTestMs>0)await new Promise(resolve=>setTimeout(resolve,smokeTestMs));return{ready:this.ready,errors:[...this.errors]}}async waitForReady(timeoutMs=2200){const start=performance.now();while(performance.now()-start<timeoutMs){if(this.ready)return true;if(this.errors.length)return false;await new Promise(resolve=>setTimeout(resolve,40))}return this.ready}sendFrame(frame){this.iframe.contentWindow?.postMessage({channel:'visualizer-host-v1',type:'frame',frame},'*')}setRuntime(runtime){this.iframe.contentWindow?.postMessage({channel:'visualizer-host-v1',type:'runtime',runtime},'*')}snapshot(timeoutMs=900){const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.snapshotRequests.delete(requestId);reject(new Error('Visualizer diagnostic snapshot timed out.'))},timeoutMs);this.snapshotRequests.set(requestId,{resolve,reject,timer});this.iframe.contentWindow?.postMessage({channel:'visualizer-host-v1',type:'diagnostic-command',command:'snapshot',requestId},'*')})}clear(){this.resetTelemetry();this.iframe.srcdoc=''}destroy(){window.removeEventListener('message',this.messageHandler);this.clear()}}
