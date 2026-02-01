/* FINAL clean rebuild (NO library). Single .py upload from disk.
   Offline render -> play AudioBuffer, visuals locked to playhead with timeline + edge traversal glow. */
const $ = (id)=>document.getElementById(id);
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const randi = (n)=>Math.floor(Math.random()*n);
const nowMs = ()=>performance.now();

let audio=null, pyodide=null, pyReady=false, pyDispatch=null;
let playing=false, rendering=false;

const DEFAULT_NODES=7, DEFAULT_EMITTERS=5, BASE_DUR=0.20;
const MAX_NODES=24;
const nodeCount=()=>graph.nodes.length;
const state={ jitter:0.25, hops:6, latScale:1.0, master:0.75 };
// Bright neon palette (stable per-node / per-edge)
function nodeHue(i){ const N=Math.max(1,nodeCount()); return ((i*360/N)+20)%360; }
function hsl(h,s,l){ return `hsl(${h} ${s}% ${l}%)`; }
function nodeColor(i, l=62, s=95){ return hsl(nodeHue(i), s, l); }
function edgeColor(a,b, l=58, s=92){ return hsl((nodeHue(a)*0.6 + nodeHue(b)*0.4)%360, s, l); }


const offline={
  duration:30, sr:48000,
  audioBuf:null, playSrc:null,
  playStartCtxTime:0, playOffset:0, lastPlayhead:0,
  events:[], traces:[], eventsRendered:0, cancel:false,
  tlWindow:10, tlGlow:1.0, _evCursor:0,
};

// ---------- Audio ----------
function initAudio(){
  const ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
  const master=ctx.createGain(); master.gain.value=state.master;

  const hp=ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=18;
  const comp=ctx.createDynamicsCompressor();
  comp.threshold.value=-18; comp.knee.value=18; comp.ratio.value=3.5;
  comp.attack.value=0.005; comp.release.value=0.12;

  master.connect(hp); hp.connect(comp); comp.connect(ctx.destination);
  audio={ctx, master};
}
function setMaster(v){
  state.master=v;
  if(audio) audio.master.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.02);
}
function stopPlayback(){
  // Freeze visuals where they are, so repeated Play restarts from a clean baseline.
  try{ freezePlayhead(); }catch(_){ }
  try{ if(offline.playSrc){ offline.playSrc.stop(); offline.playSrc.disconnect(); } }catch(_){ }
  offline.playSrc=null;
  playing=false;
}
function playRendered(offsetSec=0){
  if(!audio || !offline.audioBuf) return;
  // Always start from a consistent visual/audio state.
  stopPlayback();
  const src=audio.ctx.createBufferSource();
  src.buffer=offline.audioBuf;
  src.connect(audio.master);

  const now=audio.ctx.currentTime;
  offline.playOffset = clamp(offsetSec, 0, offline.duration);
  offline.playStartCtxTime = now;
  offline.lastPlayhead = offline.playOffset;
  offline._evCursor = 0; // IMPORTANT: restart event cursor so node flashes line up every time

  src.start(now, offline.playOffset);
  offline.playSrc=src;
  playing=true;

  src.onended=()=>{
    if(offline.playSrc===src){
      offline.playSrc=null;
      playing=false;
      offline.lastPlayhead = offline.duration;
      offline._evCursor = 0;
    }
  };
}



function getPlayheadSec(){
  if(!audio) return offline.lastPlayhead||0;
  if(!playing) return offline.lastPlayhead||0;
  const t = audio.ctx.currentTime - offline.playStartCtxTime + offline.playOffset;
  return clamp(t, 0, offline.duration||0);
}
function freezePlayhead(){
  offline.lastPlayhead = getPlayheadSec();
}

// ---------- Pyodide ----------
const DEFAULT_PY = [
`import numpy as np
def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n, dtype=np.float32)/sr
    exc=rng.standard_normal(n).astype(np.float32)
    exc*=np.exp(-t*(25.0+40.0*rng.random())).astype(np.float32)
    freqs=np.array([220,330,440,660,990], dtype=np.float32) * (1.0+0.04*rng.standard_normal(5).astype(np.float32))
    decs=np.array([2.5,3.0,3.4,3.8,4.3], dtype=np.float32) * (1.0+0.2*rng.random(5).astype(np.float32))
    y=np.zeros(n, dtype=np.float32)
    for f,d in zip(freqs,decs):
        w=2*np.pi*f/sr
        r=np.exp(-d/sr).astype(np.float32)
        a1=(2*r*np.cos(w)).astype(np.float32)
        a2=-(r*r).astype(np.float32)
        z1=np.float32(0); z2=np.float32(0)
        for i in range(n):
            x=exc[i]
            y0=x + a1*z1 + a2*z2
            z2=z1; z1=y0
            y[i]+=y0
    y*=0.18
    dly=int(0.003*sr)
    yL=y
    yR=np.concatenate([np.zeros(dly,np.float32), y[:-dly]])
    return np.stack([yL,yR], axis=1).astype(np.float32)
`,
`import numpy as np
def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n, dtype=np.float32)/sr
    f0=90 + 420*(p.get("energy",0.5)**1.5)
    f1=f0*(1.0+0.7*rng.random())
    ph=2*np.pi*(f0*t + (f1-f0)*t*t/(2*dur))
    car=np.sin(ph).astype(np.float32)
    mod=np.sin(ph*(1.0+0.013*(p.get("emitter",0)%17))).astype(np.float32)
    y=np.tanh((car+0.65*mod)*1.6).astype(np.float32)
    env=(np.exp(-t*(6.0+20.0*rng.random()))*(1.0-np.exp(-t*65.0))).astype(np.float32)
    y=(y*env*0.35).astype(np.float32)
    return np.stack([y,y], axis=1).astype(np.float32)
`,
`import numpy as np
def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n, dtype=np.float32)/sr
    base=200+1200*rng.random()
    ks=np.array([1,1.5,2.02,2.74,3.0,4.1], dtype=np.float32)
    y=np.zeros(n, np.float32)
    for k in ks:
        y += np.sin(2*np.pi*(base*k)*t + rng.random()*6.28).astype(np.float32)
    y *= (1.0/len(ks))
    x=np.float32(0.2+0.4*rng.random())
    lfo=np.empty(n, np.float32)
    for i in range(n):
        x=np.float32(3.86)*x*(1.0-x)
        lfo[i]=x
    lfo=(lfo*2-1).astype(np.float32)
    env=(np.exp(-t*(3.2+8*rng.random()))*(1.0-np.exp(-t*45.0))).astype(np.float32)
    y=np.tanh(y*(1.2+0.6*lfo))*env*0.28
    pan=(0.5 + 0.45*np.sin(2*np.pi*(0.2+0.2*rng.random())*t + rng.random()*6.28)).astype(np.float32)
    return np.stack([y*(1-pan), y*pan], axis=1).astype(np.float32)
`,
];

const nodePy = [];
const nodePyApplied = [];
function ensureNodeScripts(n){
  while(nodePy.length < n){
    const i=nodePy.length;
    const code=DEFAULT_PY[i % DEFAULT_PY.length];
    nodePy.push(code);
    nodePyApplied.push(code);
  }
  while(nodePy.length > n){ nodePy.pop(); nodePyApplied.pop(); }
}
function setPyStatus(text, ok){
  const el=$("pyStatus"); if(!el) return;
  el.textContent=text;
  el.style.borderColor = ok ? "rgba(113,247,195,.35)" : "rgba(255,107,107,.55)";
}
function pyWrapCode(i, code){ return `${code}\n\nsynth_${i}=synth\n`; }

async function initPyodideRuntime(){
  try{
    pyodide = await loadPyodide({indexURL:"https://cdn.jsdelivr.net/pyodide/v0.26.1/full/"});
    await pyodide.loadPackage(["numpy"]);
    pyReady=true;
    setPyStatus("Pyodide: ready", true);
    for(let i=0;i<nodeCount();i++) await compileNode(i);
    await buildDispatcher();
  }catch(e){
    console.error(e);
    setPyStatus("Pyodide: failed", false);
  }
}
async function compileNode(i){
  if(!pyReady) return false;
  try{
    await pyodide.runPythonAsync(pyWrapCode(i, nodePyApplied[i]));
    return true;
  }catch(e){
    console.error("Python compile error node", i, e);
    return false;
  }
}
async function buildDispatcher(){
  if(!pyReady) return;
  const code = `
import numpy as np
def _pack_f32(x):
    x=np.asarray(x, dtype=np.float32); return x.tobytes()
def dispatch(node, sr, dur, seed, p):
    fn = globals().get(f"synth_{int(node)}", None)
    if fn is None:
        y=np.zeros((int(sr*dur),2), np.float32)
        return _pack_f32(y), 2
    y = fn(sr, dur, seed, p)
    y = np.asarray(y, dtype=np.float32)
    if y.ndim==1:
        y=np.stack([y,y], axis=1)
    return _pack_f32(y), 2
`;
  await pyodide.runPythonAsync(code);
  pyDispatch = pyodide.globals.get("dispatch");
}
async function runNodeSynth(nodeIndex, params, durSec){
  if(!pyReady || !pyDispatch || !audio) return null;
  const sr=audio.ctx.sampleRate;
  const seed=(params.seed|0)>>>0;
  const p=pyodide.toPy(params);
  try{
    const out=pyDispatch(nodeIndex, sr, durSec, seed, p).toJs({copy:true});
    const bytes=out[0];
    const chans=out[1]|0;
    const f32=new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength/4);
    const frames=(f32.length/chans)|0;
    const buf=audio.ctx.createBuffer(chans, frames, sr);
    for(let ch=0; ch<chans; ch++){
      const dst=buf.getChannelData(ch);
      for(let i=0,j=ch;i<frames;i++,j+=chans) dst[i]=f32[j];
    }
    return buf;
  }catch(e){
    console.error("Python runtime error node", nodeIndex, e);
    return null;
  }finally{
    if(p && p.destroy) p.destroy();
  }
}

// ---------- Graph ----------
const graph={nodes:[], edges:[]};
let selected={node:-1, edge:-1};
let connectFrom=-1;

function initGraphPreset(){
  graph.nodes=[]; graph.edges=[];
  const cx=0.5, cy=0.52, rad=0.28;
  const N=DEFAULT_NODES;
  ensureNodeScripts(N);
  for(let i=0;i<N;i++){
    const a=(i/N)*Math.PI*2 + (Math.random()*0.5-0.25);
    graph.nodes.push({ x: cx + Math.cos(a)*rad*(0.85+0.25*Math.random()),
                       y: cy + Math.sin(a)*rad*(0.85+0.25*Math.random()),
                       r: 0.035, energy: 0 });
  }
  const used=new Set();
  for(let k=0;k<10+randi(7);k++){
    const a=randi(N);
    let b=randi(N); if(b===a) b=(b+1)%N;
    const key=`${a}->${b}`; if(used.has(key)) continue;
    used.add(key);
    graph.edges.push({a,b,latMs:60+240*Math.random()});
  }
  selected.edge=-1;
  updateEdgePanel();
}
function clearEdges(){ graph.edges=[]; selected.edge=-1; updateEdgePanel(); }
function outgoingEdges(n){
  const out=[];
  for(let i=0;i<graph.edges.length;i++){ const e=graph.edges[i]; if(e.a===n) out.push({e,i}); }
  return out;
}


// ---------- Nodes ----------
function addNode(){
  if(nodeCount() >= MAX_NODES) return;
  const i=nodeCount();
  ensureNodeScripts(i+1);
  const n={ x:0.5+(Math.random()*0.22-0.11), y:0.52+(Math.random()*0.22-0.11), r:0.035, energy:0 };
  graph.nodes.push(n);
  if(pyReady) compileNode(i).then(()=>buildDispatcher()).catch(()=>{});
  if(selected.node<0) selected.node=i;
  buildNodeTabs();
  buildEmitterUI();
}
function removeNode(index=null){
  if(nodeCount()<=1) return;
  if(index===null || index===undefined) index=nodeCount()-1;
  index=clamp(index|0,0,nodeCount()-1);

  graph.nodes.splice(index,1);
  ensureNodeScripts(nodeCount());

  const newEdges=[];
  for(const e of graph.edges){
    if(e.a===index || e.b===index) continue;
    const a=(e.a>index)? e.a-1 : e.a;
    const b=(e.b>index)? e.b-1 : e.b;
    newEdges.push({a,b,latMs:e.latMs});
  }
  graph.edges=newEdges;

  const maxI=Math.max(0,nodeCount()-1);
  for(const em of emitters){
    em.node=clamp(em.node|0,0,maxI);
    em.walkPos=clamp(em.walkPos|0,0,maxI);
    em.lastNode=clamp((em.lastNode??em.node)|0,0,maxI);
  }

  selected.node=clamp(selected.node,-1,maxI);
  if(activeNodeTab>maxI) activeNodeTab=maxI;
  if(selected.edge>=graph.edges.length) selected.edge=-1;

  buildNodeTabs();
  buildEmitterUI();
  updateEdgePanel();
  if(pyReady) buildDispatcher().catch(()=>{});
}

// ---------- Emitters ----------
const emitters=[];
function addEmitter(opts={}){
  const i = emitters.length;
  const baseRates=[1.2,2.0,3.3,5.4,8.7];
  emitters.push({
    rateHz: opts.rateHz ?? (baseRates[i%baseRates.length] * (0.9+0.3*Math.random())),
    mode: opts.mode ?? (i===0?"fixed":(i===1?"walk":"random")),
    node: clamp((opts.node ?? (i%nodeCount())), 0, Math.max(0,nodeCount()-1))|0,
    spread: opts.spread ?? 0.35,
    energyBase: opts.energyBase ?? (0.35+0.10*i),
    prob: opts.prob ?? 1.0,
    tJitter: opts.tJitter ?? 0.0,
    walkPos: 0,
    lastNode: 0
  });
  emitters[i].walkPos = emitters[i].node;
  emitters[i].lastNode = emitters[i].node;
}
function removeEmitter(index=null){
  if(!emitters.length) return;
  if(index===null || index===undefined) index = emitters.length-1;
  index = clamp(index|0, 0, emitters.length-1);
  emitters.splice(index,1);
}

function resetEmitters(){
  emitters.length=0;
  for(let i=0;i<DEFAULT_EMITTERS;i++) addEmitter({energyBase:0.35+0.12*i, spread:0.35, prob:1.0, tJitter:0.05});
}
function randomiseEmitters(){
  const modes=["fixed","walk","random","burst"];
  for(const e of emitters){
    e.rateHz=0.6+Math.random()*12;
    e.mode=modes[randi(modes.length)];
    e.node=randi(nodeCount()); e.walkPos=e.node;
    e.spread=Math.random(); e.energyBase=0.25+0.55*Math.random();
    e.prob=0.25+0.75*Math.random();
    e.tJitter=Math.random()*0.25;
  }
}
function emitterPickNode(e){
  if(e.mode==="fixed"){ e.lastNode=e.node; return e.node; }
  if(e.mode==="walk"){
    const r=Math.random();
    if(r<0.55) e.walkPos=(e.walkPos+1)%nodeCount();
    else if(r<0.90) e.walkPos=(e.walkPos-1+nodeCount())%nodeCount();
    if(Math.random()<0.08) e.walkPos=randi(nodeCount());
    e.lastNode=e.walkPos; return e.walkPos;
  }
  if(e.mode==="burst"){ if(Math.random()<0.12) e.node=randi(nodeCount()); e.lastNode=e.node; return e.node; }
  e.lastNode=randi(nodeCount()); return e.lastNode;
}

// ---------- Planner ----------
function planEvents(){
  const dur=offline.duration;
  const events=[], traces=[];
  let s=((Math.floor(nowMs())|0) ^ (graph.edges.length*65537))>>>0;
  const rand=()=>{ s=(s*1664525+1013904223)>>>0; return s/4294967296; };

  const heap=[];
  const push=x=>heap.push(x);
  const jitterTime=(base, em)=>{
    const jt=Math.max(0, Math.min(0.5, (em.tJitter ?? 0)));
    if(jt<=0) return base;
    // jitter spans +/- jt * period-ish, clamped to reasonable range
    const span=Math.max(0.01, jt);
    return base + (rand()*2-1)*span*0.5;
  };
  const popMin=()=>{
    let bi=0, bt=heap[0].t;
    for(let i=1;i<heap.length;i++) if(heap[i].t<bt){ bt=heap[i].t; bi=i; }
    const e=heap[bi]; heap[bi]=heap[heap.length-1]; heap.pop(); return e;
  };

  for(let i=0;i<emitters.length;i++){
    const step=1/Math.max(0.01, emitters[i].rateHz);
    push({ t: jitterTime(rand()*step, emitters[i]), kind:"emit", node: emitterPickNode(emitters[i]), hop:0, emitter:i,
      energy: clamp(emitters[i].energyBase + (rand()*2-1)*emitters[i].spread*0.45, 0.05, 1.0),
      seed: (s ^ (i*131071))>>>0 });
  }

  const maxPlanned=Math.floor(dur*140);
  while(heap.length && events.length<maxPlanned){
    const e=popMin();
    if(e.t>dur) break;

    if(e.kind!=="emit" || rand() <= (emitters[e.emitter].prob ?? 1.0)){
      events.push({t:e.t,node:e.node,hop:e.hop,emitter:e.emitter,energy:e.energy,seed:e.seed});
    }
    if(e.kind==="hop") traces.push({t:e.t,a:e.a,b:e.node,edgeIndex:e.edgeIndex,energy:e.energy,emitter:e.emitter});

    if(e.kind==="emit"){
      const step=1/Math.max(0.01, emitters[e.emitter].rateHz);
      const nt=jitterTime(e.t+step, emitters[e.emitter]);
      if(nt<=dur) push({ t:nt, kind:"emit", node: emitterPickNode(emitters[e.emitter]), hop:0, emitter:e.emitter,
        energy: clamp(emitters[e.emitter].energyBase + (rand()*2-1)*emitters[e.emitter].spread*0.45, 0.05, 1.0),
        seed: (e.seed*1664525+1013904223)>>>0 });
    }

    if(e.hop>=state.hops) continue;
    const outs=outgoingEdges(e.node);
    if(!outs.length) continue;
    const picks=(rand() < (0.25+0.55*e.energy)) ? 2 : 1;
    for(let k=0;k<picks;k++){
      const pick=outs[Math.floor(rand()*outs.length)];
      const ed=pick.e, edgeIndex=pick.i;
      const lat=ed.latMs*state.latScale;
      const jit=1+(rand()*2-1)*state.jitter*0.35;
      const nt=e.t + (lat*jit)/1000;
      if(nt>dur) continue;
      const ne=clamp(e.energy*0.86 + 0.12*rand(), 0, 1);
      push({ t:nt, kind:"hop", node:ed.b, hop:e.hop+1, emitter:e.emitter, energy:ne,
        seed:(e.seed*1664525+1013904223)>>>0, edgeIndex, a:ed.a });
    }
  }

  events.sort((a,b)=>a.t-b.t);
  traces.sort((a,b)=>a.t-b.t);
  offline.events=events; offline.traces=traces; offline._evCursor=0;
  return {events,traces};
}

// ---------- Offline FX ----------
function biquadCoeffsBandpass(sr,f0,Q){
  const w0=2*Math.PI*f0/sr, cosw=Math.cos(w0), sinw=Math.sin(w0);
  const alpha=sinw/(2*Q);
  let b0=alpha,b1=0,b2=-alpha,a0=1+alpha,a1=-2*cosw,a2=1-alpha;
  b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
  return {b0,b1,b2,a1,a2};
}
function applyBiquadInPlace(x,c){
  let z1=0,z2=0;
  for(let i=0;i<x.length;i++){
    const y=c.b0*x[i]+z1;
    z1=c.b1*x[i]-c.a1*y+z2;
    z2=c.b2*x[i]-c.a2*y;
    x[i]=y;
  }
}
function applyFeedbackDelay(x,sr,delaySec,fb){
  const d=Math.max(1,Math.floor(delaySec*sr));
  const buf=new Float32Array(d); let w=0;
  for(let i=0;i<x.length;i++){
    const y=buf[w];
    buf[w]=x[i]+y*fb;
    x[i]=x[i]+y*0.65;
    if(++w>=d) w=0;
  }
}
function softClipInPlace(L,R,drive=1.15){
  for(let i=0;i<L.length;i++){ L[i]=Math.tanh(L[i]*drive); R[i]=Math.tanh(R[i]*drive); }
}
function simpleReverb(L,R,sr,mix=0.18){
  const combDel=[0.0297,0.0371,0.0411,0.0437], combFb=[0.74,0.72,0.70,0.68], apDel=[0.005,0.0017], apFb=0.55;
  const combProcess=(x)=>{
    const out=new Float32Array(x.length);
    const bufs=combDel.map(d=>new Float32Array(Math.max(1,Math.floor(d*sr))));
    const idxs=combDel.map(()=>0);
    for(let i=0;i<x.length;i++){
      let y=0;
      for(let c=0;c<4;c++){
        const b=bufs[c]; let k=idxs[c];
        const v=b[k];
        b[k]=x[i]+v*combFb[c];
        idxs[c]=(k+1)%b.length;
        y+=v;
      }
      out[i]=y*0.25;
    }
    return out;
  };
  const allpass=(x,dSec)=>{
    const d=Math.max(1,Math.floor(dSec*sr));
    const buf=new Float32Array(d); let k=0;
    for(let i=0;i<x.length;i++){
      const v=buf[k], inp=x[i];
      const y=-apFb*inp + v;
      buf[k]=inp + apFb*y;
      x[i]=y;
      if(++k>=d) k=0;
    }
  };
  const wetL=combProcess(L), wetR=combProcess(R);
  allpass(wetL, apDel[0]); allpass(wetL, apDel[1]);
  allpass(wetR, apDel[0]); allpass(wetR, apDel[1]);
  const dry=1-mix;
  for(let i=0;i<L.length;i++){ L[i]=L[i]*dry + wetL[i]*mix; R[i]=R[i]*dry + wetR[i]*mix; }
}

function setRenderStatus(msg){ const el=$("renderStatus"); if(el) el.textContent=msg||""; }

async function renderTimeline(){
  if(rendering) return;
  if(!audio) initAudio();
  await audio.ctx.resume();
  if(!pyReady || !pyDispatch){ setRenderStatus("Pyodide not ready…"); return; }

  rendering=true;
  offline.cancel=false;
  stopPlayback();
  setRenderStatus("Planning…");

  const sr=offline.sr=audio.ctx.sampleRate;
  const dur=offline.duration;
  const frames=Math.floor(dur*sr);
  const mixL=new Float32Array(frames);
  const mixR=new Float32Array(frames);

  const {events}=planEvents();
  offline.eventsRendered=0;
  setRenderStatus(`Rendering ${events.length} events…`);

  const t0=nowMs();
  for(let i=0;i<events.length;i++){
    if(offline.cancel) break;
    const e=events[i];
    const durSec=BASE_DUR*(0.65+0.55*e.energy);
    const buf=await runNodeSynth(e.node, {x:e.node, emitter:e.emitter, hop:e.hop, energy:e.energy, seed:e.seed}, durSec);
    if(!buf) continue;

    const L=new Float32Array(buf.getChannelData(0));
    const R=new Float32Array(buf.getChannelData(1));

    const f0=200 + 3400*(0.15 + 0.85*e.energy);
    const Q=0.6 + 10*Math.random();
    const bp=biquadCoeffsBandpass(sr, f0, Q);
    applyBiquadInPlace(L, bp);
    applyBiquadInPlace(R, bp);
    applyFeedbackDelay(L, sr, 0.001+0.016*Math.random(), 0.10+0.22*Math.random());
    applyFeedbackDelay(R, sr, 0.001+0.016*Math.random(), 0.10+0.22*Math.random());

    const start=Math.floor(e.t*sr);
    const end=Math.min(frames, start+L.length);

    const pan=((e.node/(Math.max(0,nodeCount()-1)))*2-1)*0.75;
    const gl=Math.sqrt(0.5*(1-pan));
    const gr=Math.sqrt(0.5*(1+pan));
    const g=0.70 + 0.25*e.energy;

    for(let k=start, j=0; k<end; k++, j++){
      mixL[k] += L[j]*g*gl;
      mixR[k] += R[j]*g*gr;
    }

    offline.eventsRendered++;
    if((i & 7)===0){
      const ms=nowMs()-t0;
      setRenderStatus(`Rendering ${offline.eventsRendered}/${events.length} (${(ms/1000).toFixed(1)}s)…`);
      await new Promise(r=>setTimeout(r,0));
    }
  }

  simpleReverb(mixL, mixR, sr, 0.18);
  softClipInPlace(mixL, mixR, 1.15);

  let peak=0;
  for(let i=0;i<frames;i++){
    const a=Math.abs(mixL[i]), b=Math.abs(mixR[i]);
    if(a>peak) peak=a;
    if(b>peak) peak=b;
  }
  if(peak>1.0){
    const g=0.98/peak;
    for(let i=0;i<frames;i++){ mixL[i]*=g; mixR[i]*=g; }
  }

  const out=audio.ctx.createBuffer(2, frames, sr);
  out.getChannelData(0).set(mixL);
  out.getChannelData(1).set(mixR);
  offline.audioBuf=out;

  rendering=false;
  setRenderStatus(offline.cancel ? "Cancelled." : `Done. Rendered ${offline.eventsRendered}/${events.length}.`);
}

// ---------- Visuals ----------
const EMIT_COLS=[[113,247,195],[122,167,255],[255,198,88],[255,107,107],[181,140,255],[88,244,255],[255,120,210],[170,255,120],[255,150,120],[160,200,255]];

const cv=$("cv");
const ctx2d=cv.getContext("2d");
const tlCv=$("timeline");
const tlCtx=tlCv.getContext("2d");

function resize(){
  const dpr=Math.max(1,Math.min(2.5,window.devicePixelRatio||1));
  cv.width=Math.floor(cv.clientWidth*dpr);
  cv.height=Math.floor(cv.clientHeight*dpr);
  tlCv.width=Math.floor(tlCv.clientWidth*dpr);
  tlCv.height=Math.floor(tlCv.clientHeight*dpr);
  ctx2d.setTransform(dpr,0,0,dpr,0,0);
  tlCtx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener("resize", resize);

function n2p(n){ return {x:n.x*cv.clientWidth, y:n.y*cv.clientHeight}; }
function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }

let dragNode=-1;
let dragOff={x:0,y:0};

cv.addEventListener("mousedown",(e)=>{
  const rect=cv.getBoundingClientRect();
  const mx=e.clientX-rect.left, my=e.clientY-rect.top;

  let hit=-1;
  for(let i=0;i<graph.nodes.length;i++){
    const p=n2p(graph.nodes[i]);
    const rr=graph.nodes[i].r*Math.min(cv.clientWidth, cv.clientHeight);
    if(dist2(mx,my,p.x,p.y) < rr*rr){ hit=i; break; }
  }

  if(hit>=0){
    selected.node=hit;
    dragNode=hit;
    const p=n2p(graph.nodes[hit]);
    dragOff.x=mx-p.x; dragOff.y=my-p.y;

    if(e.shiftKey){
      if(connectFrom<0) connectFrom=hit;
      else if(connectFrom!==hit){
        graph.edges.push({a:connectFrom, b:hit, latMs:60+240*Math.random()});
        connectFrom=-1;
      }else connectFrom=-1;
      updateEdgePanel();
    }
    return;
  }

  selected.edge = hitEdge(mx,my);
  updateEdgePanel();
});

window.addEventListener("mousemove",(e)=>{
  if(dragNode<0) return;
  const rect=cv.getBoundingClientRect();
  const mx=e.clientX-rect.left, my=e.clientY-rect.top;
  const nx=(mx-dragOff.x)/cv.clientWidth;
  const ny=(my-dragOff.y)/cv.clientHeight;
  const n=graph.nodes[dragNode];
  n.x=clamp(nx,0.06,0.94);
  n.y=clamp(ny,0.08,0.92);
});
window.addEventListener("mouseup",()=>{ dragNode=-1; });

function pointSegDist(px,py,x1,y1,x2,y2){
  const vx=x2-x1, vy=y2-y1;
  const wx=px-x1, wy=py-y1;
  const c1=vx*wx + vy*wy;
  if(c1<=0) return Math.hypot(px-x1,py-y1);
  const c2=vx*vx + vy*vy;
  if(c2<=c1) return Math.hypot(px-x2,py-y2);
  const t=c1/c2;
  return Math.hypot(px-(x1+t*vx), py-(y1+t*vy));
}
function hitEdge(mx,my){
  let best=-1, bestD=1e9;
  for(let i=0;i<graph.edges.length;i++){
    const e=graph.edges[i];
    const a=n2p(graph.nodes[e.a]);
    const b=n2p(graph.nodes[e.b]);
    const d=pointSegDist(mx,my,a.x,a.y,b.x,b.y);
    if(d<10 && d<bestD){ bestD=d; best=i; }
  }
  return best;
}

function edgeGlowAtTime(tNow){
  const glow=new Float32Array(graph.edges.length);
  const tr=offline.traces;
  if(!tr || !tr.length) return glow;
  const win=0.08;
  let lo=0, hi=tr.length-1;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(tr[mid].t < tNow-win) lo=mid+1; else hi=mid;
  }
  for(let i=lo;i<tr.length && tr[i].t<=tNow+win;i++){
    const e=tr[i];
    const idx=e.edgeIndex|0;
    if(idx>=0 && idx<glow.length){
      const dt=Math.abs(e.t-tNow);
      const k=Math.exp(-dt*35) * (0.35+0.65*e.energy) * offline.tlGlow;
      if(k>glow[idx]) glow[idx]=k;
    }
  }
  return glow;
}

function renderTimelinePanel(){
  const w=tlCv.clientWidth, h=tlCv.clientHeight;
  tlCtx.clearRect(0,0,w,h);
  tlCtx.fillStyle="#07080b"; tlCtx.fillRect(0,0,w,h);

  const evs=offline.events;
  if(!evs || !evs.length){
    tlCtx.fillStyle="rgba(147,160,179,0.8)";
    tlCtx.font="12px ui-monospace, Menlo, monospace";
    tlCtx.fillText("No render yet. Click Render.", 10, 18);
    return;
  }

  const tNow = getPlayheadSec();
  offline.lastPlayhead = tNow;

  const win=offline.tlWindow;
  const leftT=Math.max(0, tNow - win*0.75);
  const rightT=leftT + win;
  const xOf=(t)=>((t-leftT)/win)*w;

  tlCtx.strokeStyle="rgba(36,48,65,0.75)";
  tlCtx.lineWidth=1;
  tlCtx.beginPath();
  for(let s=Math.floor(leftT); s<=rightT; s++){
    const x=xOf(s);
    tlCtx.moveTo(x,0); tlCtx.lineTo(x,h);
  }
  tlCtx.stroke();

  const laneH=h/Math.max(1,nodeCount());
  tlCtx.strokeStyle="rgba(36,48,65,0.55)";
  tlCtx.beginPath();
  for(let n=1;n<nodeCount();n++){
    const y=n*laneH;
    tlCtx.moveTo(0,y); tlCtx.lineTo(w,y);
  }
  tlCtx.stroke();

  let lo=0, hi=evs.length-1;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(evs[mid].t < leftT) lo=mid+1; else hi=mid;
  }
  for(let i=lo;i<evs.length && evs[i].t<=rightT;i++){
    const e=evs[i];
    const x=xOf(e.t);
    const y0=e.node*laneH, y1=y0+laneH;
    const a=0.25+0.65*e.energy;
    tlCtx.strokeStyle=`rgba(113,247,195,${a})`;
    tlCtx.beginPath(); tlCtx.moveTo(x,y0+2); tlCtx.lineTo(x,y1-2); tlCtx.stroke();
  }

  const tr=offline.traces||[];
  if(tr.length){
    let lo2=0, hi2=tr.length-1;
    while(lo2<hi2){
      const mid=(lo2+hi2)>>1;
      if(tr[mid].t < leftT) lo2=mid+1; else hi2=mid;
    }
    for(let i=lo2;i<tr.length && tr[i].t<=rightT;i++){
      const e=tr[i];
      const x=xOf(e.t);
      const y=(e.b+0.5)*laneH;
      const a=0.12+0.35*e.energy;
      tlCtx.fillStyle=`rgba(122,167,255,${a})`;
      tlCtx.fillRect(x-1, y-1, 2, 2);
    }
  }

  const phX=xOf(tNow);
  tlCtx.strokeStyle="rgba(255,255,255,0.85)";
  tlCtx.lineWidth=2;
  tlCtx.beginPath(); tlCtx.moveTo(phX,0); tlCtx.lineTo(phX,h); tlCtx.stroke();
}

function renderScene(){
  const w=cv.clientWidth, h=cv.clientHeight;
  ctx2d.clearRect(0,0,w,h);
  ctx2d.fillStyle="#05070a"; ctx2d.fillRect(0,0,w,h);

  const tNow = getPlayheadSec();
  const edgeGlow=edgeGlowAtTime(tNow);

  for(let i=0;i<graph.edges.length;i++){
    const e=graph.edges[i];
    const a=n2p(graph.nodes[e.a]);
    const b=n2p(graph.nodes[e.b]);
    const sel=(i===selected.edge);
    const g=edgeGlow[i]||0;
    const alpha=sel?0.95:(0.40+0.35*g);
    const rr=Math.round(36+120*g), gg=Math.round(48+120*g), bb=Math.round(65+160*g);
    const baseCol = edgeColor(e.a, e.b, sel?66:(56+12*g), sel?98:(92+6*g));
    ctx2d.strokeStyle = baseCol.replace("hsl","hsla").replace(")", ` / ${alpha})`);
    ctx2d.lineWidth = sel ? 2.4 : (1.0+2.6*g);

    ctx2d.beginPath();
    ctx2d.moveTo(a.x,a.y);
    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
    const bend=0.09;
    const nx=(b.y-a.y), ny=-(b.x-a.x);
    ctx2d.quadraticCurveTo(mx+nx*bend, my+ny*bend, b.x, b.y);
    ctx2d.stroke();

    const ang=Math.atan2(b.y-my, b.x-mx);
    const ah=7;
    ctx2d.fillStyle=ctx2d.strokeStyle;
    ctx2d.beginPath();
    ctx2d.moveTo(b.x,b.y);
    ctx2d.lineTo(b.x-ah*Math.cos(ang-0.6), b.y-ah*Math.sin(ang-0.6));
    ctx2d.lineTo(b.x-ah*Math.cos(ang+0.6), b.y-ah*Math.sin(ang+0.6));
    ctx2d.closePath();
    ctx2d.fill();

    ctx2d.fillStyle = sel ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.80)";
    ctx2d.font="12px ui-monospace, Menlo, monospace";
    ctx2d.fillText(`${Math.round(e.latMs)}ms`, mx+8, my-6);
  }

  for(let i=0;i<graph.nodes.length;i++){
    const n=graph.nodes[i];
    const p=n2p(n);
    const rr=n.r*Math.min(w,h);
    const en=clamp(n.energy,0,1.6);
    const sel=(i===selected.node);

    ctx2d.fillStyle = nodeColor(i, 60+10*en, 98).replace("hsl","hsla").replace(")", ` / ${0.10+0.22*en})`);
    ctx2d.beginPath(); ctx2d.arc(p.x,p.y, rr*(2.2+2.4*en), 0, Math.PI*2); ctx2d.fill();

    ctx2d.fillStyle = sel ? nodeColor(i, 64, 98).replace("hsl","hsla").replace(")", " / 0.30)") : "rgba(10,12,16,0.90)";
    ctx2d.strokeStyle = sel ? nodeColor(i, 70, 98).replace("hsl","hsla").replace(")", " / 0.95)") : nodeColor(i, 62, 92).replace("hsl","hsla").replace(")", " / 0.75)");
    ctx2d.lineWidth = sel ? 2.4 : 1.4;
    ctx2d.beginPath(); ctx2d.arc(p.x,p.y, rr*(1.15+0.25*en), 0, Math.PI*2); ctx2d.fill(); ctx2d.stroke();

    ctx2d.strokeStyle = nodeColor(i, 72, 98).replace("hsl","hsla").replace(")", ` / ${0.35+0.55*en})`);
    ctx2d.lineWidth=1.2;
    ctx2d.beginPath(); ctx2d.arc(p.x,p.y, rr*(0.6+0.55*en), 0, Math.PI*2); ctx2d.stroke();

    ctx2d.fillStyle="rgba(255,255,255,0.92)";
    ctx2d.font="13px ui-monospace, Menlo, monospace";
    ctx2d.fillText(`N${i}`, p.x-10, p.y+4);
  }


  // Emitter indicators: small orbiting dots around their current target nodes
  for(let ei=0; ei<emitters.length; ei++){
    const em=emitters[ei];
    const ni=(em.mode==="walk") ? (em.walkPos|0) : ((em.lastNode ?? em.node)|0);
    if(!(ni>=0 && ni<nodeCount())) continue;
    const nn=graph.nodes[ni];
    const pp=n2p(nn);
    const rr=nn.r*Math.min(w,h);
    const col=EMIT_COLS[ei % EMIT_COLS.length];
    const ang=(tNow*0.9 + ei*0.9) % (Math.PI*2);
    const ox=Math.cos(ang)*rr*1.55;
    const oy=Math.sin(ang)*rr*1.55;
    ctx2d.fillStyle=`rgba(${col[0]},${col[1]},${col[2]},0.85)`;
    ctx2d.beginPath();
    ctx2d.arc(pp.x+ox, pp.y+oy, Math.max(2.5, rr*0.22), 0, Math.PI*2);
    ctx2d.fill();
    ctx2d.fillStyle=`rgba(${col[0]},${col[1]},${col[2]},0.75)`;
    ctx2d.font="11px ui-monospace, Menlo, monospace";
    ctx2d.fillText(`E${ei}`, pp.x+ox+6, pp.y+oy+4);
  }

  if(connectFrom>=0){
    ctx2d.fillStyle="rgba(255,255,255,0.06)";
    ctx2d.fillRect(0,0,w,h);
    ctx2d.fillStyle="rgba(122,167,255,0.95)";
    ctx2d.font="12px ui-monospace, Menlo, monospace";
    ctx2d.fillText("Shift+click another node to connect…", 12, h-16);
  }

  const hud=$("hud");
  if(hud){
    const mode = rendering ? "RENDER" : (playing ? "PLAY" : "IDLE");
    hud.textContent = `${mode} | edges ${graph.edges.length} | events ${offline.eventsRendered}/${offline.events.length} | sr ${audio?audio.ctx.sampleRate:"—"}`;
  }
}

// ---------- UI ----------
let activeNodeTab=0;

function buildEmitterUI(){
  const wrap=$("emitters");
  if(!wrap) return;
  wrap.innerHTML="";
  emitters.forEach((e,i)=>{
    const div=document.createElement("div");
    div.className="card";
    div.style.marginBottom="10px";
    div.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center; margin:0 0 6px 0;"><h2 style="margin:0;">Emitter ${i}</h2><button id="edel_${i}" class="danger" style="padding:6px 10px;">Delete</button></div>
      <div class="row"><label>Mode</label>
        <select id="emode_${i}">
          <option value="fixed">fixed</option>
          <option value="walk">walk</option>
          <option value="random">random</option>
          <option value="burst">burst</option>
        </select>
      </div>
      <div class="row"><label>Rate (Hz)</label>
        <input id="erate_${i}" type="range" min="0.2" max="20" step="0.01" value="${e.rateHz}">
      </div>
      <div class="row"><label></label>
        <span class="pill"><span id="erate_lbl_${i}">${e.rateHz.toFixed(2)}</span></span>
      </div>
      <div class="row"><label>Node</label>
        <input id="enode_${i}" type="number" min="0" max="${Math.max(0,nodeCount()-1)}" step="1" value="${e.node}">
      </div>
      <div class="row"><label>Spread</label>
        <input id="espread_${i}" type="range" min="0" max="1" step="0.001" value="${e.spread}">
      </div>
      <div class="row"><label>Probability</label>
        <input id="eprob_${i}" type="range" min="0" max="1" step="0.001" value="${e.prob ?? 1}">
      </div>
      <div class="row"><label></label>
        <span class="pill"><span id="eprob_lbl_${i}">${(e.prob ?? 1).toFixed(3)}</span></span>
      </div>
      <div class="row"><label>Jitter</label>
        <input id="ejit_${i}" type="range" min="0" max="0.5" step="0.001" value="${e.tJitter ?? 0}">
      </div>
      <div class="row"><label></label>
        <span class="pill"><span id="ejit_lbl_${i}">${(e.tJitter ?? 0).toFixed(3)}</span></span>
      </div>
    `;
    wrap.appendChild(div);

    const emode=$(`emode_${i}`);
    if(emode){ emode.value=e.mode; emode.addEventListener("change",()=>{ e.mode=emode.value; }); }

    const erate=$(`erate_${i}`), lbl=$(`erate_lbl_${i}`);
    if(erate) erate.addEventListener("input",()=>{ e.rateHz=parseFloat(erate.value); if(lbl) lbl.textContent=e.rateHz.toFixed(2); });

    const enode=$(`enode_${i}`);
    if(enode) enode.addEventListener("change",()=>{ e.node=clamp(parseInt(enode.value||e.node,10),0,Math.max(0,nodeCount()-1))|0; e.walkPos=e.node; enode.value=e.node; });

    const espread=$(`espread_${i}`);
    if(espread) espread.addEventListener("input",()=>{ e.spread=parseFloat(espread.value); });

    const del=$(`edel_${i}`);
    if(del) del.addEventListener("click", (ev)=>{ ev.preventDefault(); ev.stopPropagation(); removeEmitter(i); buildEmitterUI(); });
  });
}

function buildNodeTabs(){
  const tabs=$("nodeTabs");
  if(!tabs) return;
  tabs.innerHTML="";
  for(let i=0;i<nodeCount();i++){
    const t=document.createElement("div");
    t.className="tab"+(i===activeNodeTab?" active":"");
    t.textContent=`N${i}`;
    t.onclick=()=>{
      activeNodeTab=i;
      [...tabs.children].forEach((c,ix)=>c.classList.toggle("active", ix===i));
      const pc=$("pyCode"); if(pc) pc.value=nodePy[i];
      const pm=$("pyMsg"); if(pm) pm.textContent="";
    };
    tabs.appendChild(t);
  }
  const pc=$("pyCode"); if(pc) pc.value=nodePy[activeNodeTab];
}

function updateEdgePanel(){
  const idx=selected.edge;
  const lab=$("edgeLabel");
  const r=$("edgeLatency");
  const n=$("edgeLatencyNum");
  if(idx<0 || idx>=graph.edges.length){
    if(lab) lab.textContent="No edge selected.";
    return;
  }
  const e=graph.edges[idx];
  if(lab) lab.textContent=`Edge: N${e.a} → N${e.b}`;
  if(r) r.value=String(Math.round(e.latMs));
  if(n) n.value=String(Math.round(e.latMs));
}

function bind(id, fn){
  const el=$(id);
  if(el) fn(el);
}

function hookControls(){
  bind("master", el=>el.addEventListener("input", e=>setMaster(parseFloat(e.target.value))));
  bind("duration", el=>el.addEventListener("input", e=>{
    offline.duration=parseInt(e.target.value,10);
    const dl=$("durationLbl"); if(dl) dl.textContent=String(offline.duration);
  }));
  bind("tlWindow", el=>el.addEventListener("input", e=>{
    offline.tlWindow=parseInt(e.target.value,10);
    const tl=$("tlWindowLbl"); if(tl) tl.textContent=String(offline.tlWindow);
  }));
  bind("tlGlow", el=>el.addEventListener("input", e=>{ offline.tlGlow=parseFloat(e.target.value); }));

  bind("btnRender", el=>el.onclick=async()=>{ await renderTimeline(); });
  bind("btnPlay", el=>el.onclick=async()=>{
    if(!audio) initAudio();
    await audio.ctx.resume();
    playRendered(0);
  });
  bind("btnStop", el=>el.onclick=()=>{ stopPlayback(); offline.cancel=true; });

  bind("btnResetEmitters", el=>el.onclick=()=>{ resetEmitters(); buildEmitterUI(); });
  bind("btnRandomEmitters", el=>el.onclick=()=>{ randomiseEmitters(); buildEmitterUI(); });
  bind("btnAddEmitter", el=>el.onclick=()=>{ addEmitter({}); buildEmitterUI(); });
  bind("btnRemoveEmitter", el=>el.onclick=()=>{ removeEmitter(); buildEmitterUI(); });

  bind("btnGraphPreset", el=>el.onclick=()=>{ initGraphPreset(); });
  bind("btnClearEdges", el=>el.onclick=()=>{ clearEdges(); });

  bind("btnAddNode", el=>el.onclick=()=>{ addNode(); });
  bind("btnRemoveNode", el=>el.onclick=()=>{ removeNode(); });

  const r=$("edgeLatency"), n=$("edgeLatencyNum");
  const sync=(val)=>{
    const idx=selected.edge;
    if(idx>=0 && idx<graph.edges.length) graph.edges[idx].latMs=val;
    if(r) r.value=String(val);
    if(n) n.value=String(val);
  };
  if(r) r.addEventListener("input", ()=>sync(parseInt(r.value,10)));
  if(n) n.addEventListener("change", ()=>sync(parseInt(n.value,10)));

  bind("btnApplyPy", el=>el.onclick=async()=>{
    const pc=$("pyCode"); if(!pc) return;
    nodePyApplied[activeNodeTab]=pc.value;
    const ok=await compileNode(activeNodeTab);
    const pm=$("pyMsg");
    if(pm) pm.textContent = ok ? "Applied ✓" : "Python error (see console)";
    if(ok){
      nodePy[activeNodeTab]=pc.value;
      await buildDispatcher();
    }
  });
  bind("btnRevertPy", el=>el.onclick=()=>{
    const pc=$("pyCode"); if(pc) pc.value=nodePyApplied[activeNodeTab];
    const pm=$("pyMsg"); if(pm) pm.textContent="Reverted";
  });
  bind("btnLoadPy", el=>el.onclick=()=>{ const inp=$("filePy"); if(inp) inp.click(); });

  bind("filePy", inp=>{
    inp.addEventListener("change", async()=>{
      const f=inp.files && inp.files[0];
      if(!f) return;
      const txt=await f.text();
      const pc=$("pyCode"); if(pc) pc.value=txt;
      const pm=$("pyMsg"); if(pm) pm.textContent=`Loaded file: ${f.name} (not applied yet)`;
      inp.value="";
    });
  });

  bind("btnExportFile", el=>el.onclick=()=>{
    const pc=$("pyCode"); if(!pc) return;
    const blob=new Blob([pc.value], {type:"text/x-python"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`node_${activeNodeTab}_synth.py`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  });

  window.addEventListener("keydown", async(e)=>{
    if(e.code==="Space"){
      e.preventDefault();
      if(!audio) initAudio();
      await audio.ctx.resume();
      if(playing){ stopPlayback(); } else { playRendered(0); }
    }
    if(e.key==="Delete" || e.key==="Backspace"){
      if(selected.edge>=0){
        graph.edges.splice(selected.edge,1);
        selected.edge=-1;
        updateEdgePanel();
      }
    }
  });
}

// ---------- Animation ----------
let lastT=0;
function frame(){
  requestAnimationFrame(frame);
  const t=nowMs();
  const dt=(t-lastT)/1000;
  lastT=t;

  for(const n of graph.nodes) n.energy*=Math.pow(0.06, dt);

  if(playing && offline.events && audio){
    const tNow=getPlayheadSec();
    const win=0.030;
    const evs=offline.events;
    let i=offline._evCursor||0;
    while(i<evs.length && evs[i].t < tNow-win) i++;
    offline._evCursor=i;
    for(let j=i;j<evs.length && evs[j].t <= tNow+win; j++){
      const e=evs[j];
      graph.nodes[e.node].energy=clamp(graph.nodes[e.node].energy + 0.9*(0.35+e.energy), 0, 1.8);
    }
  }

  renderScene();
  renderTimelinePanel();
}

function boot(){
  resetEmitters();
  initGraphPreset();
  buildEmitterUI();
  buildNodeTabs();
  hookControls();
  resize();

  const dl=$("durationLbl"); if(dl) dl.textContent=String(offline.duration);
  const tw=$("tlWindowLbl"); if(tw) tw.textContent=String(offline.tlWindow);

  initPyodideRuntime();
  frame();
}
boot();
