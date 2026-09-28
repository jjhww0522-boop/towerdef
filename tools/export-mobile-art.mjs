// Deterministic vector rasterization + original procedural audio export.
// Only writes the owned MobileArt output/source directories and their contract.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { units, enemies, unitStates, enemyStates, unitSvg, enemySvg } from '../assets/mobile-art/source.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sourceRoot=resolve(root,'assets/mobile-art');
const outputRoot=resolve(root,'client/Assets/Resources/MobileArt');
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const files=[];
async function save(path, data){await mkdir(dirname(path),{recursive:true});await writeFile(path,data);}
async function meta(path,kind){
  const guid=sha(relative(root,path).replaceAll('\\','/')).slice(0,32);
  let body;
  if(kind==='sprite')body=`TextureImporter:\n  internalIDToNameTable: []\n  externalObjects: {}\n  serializedVersion: 13\n  mipmaps:\n    enableMipMap: 0\n    sRGBTexture: 1\n  isReadable: 0\n  textureFormat: 1\n  maxTextureSize: 512\n  textureSettings:\n    serializedVersion: 2\n    filterMode: 1\n    aniso: 1\n    mipBias: 0\n    wrapU: 1\n    wrapV: 1\n    wrapW: 1\n  nPOTScale: 0\n  lightmap: 0\n  compressionQuality: 50\n  spriteMode: 1\n  spriteExtrude: 1\n  spriteMeshType: 0\n  alignment: 9\n  spritePivot: {x: 0.5, y: 0.09375}\n  spritePixelsToUnits: 128\n  alphaUsage: 1\n  alphaIsTransparency: 1\n  spriteTessellationDetail: -1\n  textureType: 8\n  textureShape: 1\n  singleChannelComponent: 0\n  flipbookRows: 1\n  flipbookColumns: 1\n  platformSettings:\n  - serializedVersion: 3\n    buildTarget: DefaultTexturePlatform\n    maxTextureSize: 512\n    resizeAlgorithm: 0\n    textureFormat: -1\n    textureCompression: 0\n    compressionQuality: 50\n    crunchedCompression: 0\n    allowsAlphaSplitting: 0\n    overridden: 0\n    androidETC2FallbackOverride: 0\n    forceMaximumCompressionQuality_BC6H_BC7: 0\n  spriteSheet:\n    serializedVersion: 2\n    sprites: []\n    outline: []\n    physicsShape: []\n    bones: []\n    spriteID: ${guid}\n    internalID: 0\n    vertices: []\n    indices:\n    edges: []\n    weights: []\n    secondaryTextures: []\n    nameFileIdTable: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n`;
  else body=`AudioImporter:\n  externalObjects: {}\n  serializedVersion: 7\n  defaultSettings:\n    serializedVersion: 2\n    loadType: 0\n    sampleRateSetting: 0\n    sampleRateOverride: 48000\n    compressionFormat: 1\n    quality: 1\n    conversionMode: 0\n    preloadAudioData: 1\n  platformSettingOverrides: {}\n  forceToMono: 1\n  normalize: 0\n  ambisonic: 0\n  3D: 0\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n`;
  await save(path+'.meta',`fileFormatVersion: 2\nguid: ${guid}\n${body}`);
}
function wav(samples,rate){
  const b=Buffer.alloc(44+samples.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);
  b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples.length*2,40);
  samples.forEach((v,i)=>b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));return b;
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
  const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});
  await page.setContent('<html><body style="margin:0"></body></html>');
  async function render(svg,size){
    return page.evaluate(async({svg,size})=>{
      const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0,size,size);const bytes=ctx.getImageData(0,0,size,size).data;
      let visible=0,minX=size,minY=size,maxX=-1,maxY=-1;
      for(let p=0;p<bytes.length;p+=4)if(bytes[p+3]>8){const n=p/4,x=n%size,y=Math.floor(n/size);visible++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
      if(visible<200||minX===0||minY===0||maxX===size-1||maxY===size-1)throw Error('Empty or clipped vector '+[visible,minX,minY,maxX,maxY]);
      return {png:canvas.toDataURL('image/png').split(',')[1],bounds:[minX,minY,maxX,maxY],visible};
    },{svg,size});
  }
  async function exportSprite(key,svg,size){
    const rendered=await render(svg,size).catch(error=>{throw new Error(key+': '+error.message);}), png=Buffer.from(rendered.png,'base64');
    await save(resolve(sourceRoot,'svg',key+'.svg'),svg+'\n');
    const path=resolve(outputRoot,key+'.png');await save(path,png);await meta(path,'sprite');
    files.push({path:'MobileArt/'+key+'.png',source:'assets/mobile-art/svg/'+key+'.svg',sha256:sha(png),size,bounds:rendered.bounds});
  }
  for(const unit of units){
    for(const state of unitStates)for(let frame=0;frame<4;frame++)await exportSprite(`Units/${unit.id}/${state}_${String(frame).padStart(2,'0')}`,unitSvg(unit,state,frame),256);
    await exportSprite(`Portraits/${unit.id}`,unitSvg(unit),256);
    await exportSprite(`Icons/${unit.id}`,unitSvg(unit),128);
  }
  for(const enemy of enemies)for(const state of enemyStates)for(let frame=0;frame<4;frame++)await exportSprite(`Enemies/${enemy}/${state}_${String(frame).padStart(2,'0')}`,enemySvg(enemy,state,frame),enemy==='boss'?512:256);
  const audioSource=await readFile(resolve(root,'playtest/combat-audio.js'),'utf8');
  const sounds=[...['fire','water','frost','wind','electric','laser'].map(element=>({id:element,type:'bolt',element})),
    {id:'assemble',type:'combine'},{id:'warn',type:'alarm'},{id:'boss',type:'boss-entry'},{id:'victory',type:'victory'},{id:'pulse',type:'emp'}];
  const audio=[];
  for(const sound of sounds){
    const result=await page.evaluate(async({source,sound})=>{
      const rate=48000,context=new OfflineAudioContext(1,rate,rate);
      if(sound.type==='victory'){
        // Original three-note ascending confirmation, no sampled music.
        [392,523.25,659.25].forEach((hz,i)=>{const osc=context.createOscillator(),gain=context.createGain();osc.type='triangle';osc.frequency.value=hz;osc.connect(gain);gain.connect(context.destination);const at=i*.12;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.04,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+.29);osc.start(at);osc.stop(at+.31);});
      }else{
        const create=new Function(source.replace('export function createCombatAudio','function createCombatAudio')+';return createCombatAudio;')();
        // Offline contexts are suspended until rendering; expose the same online scheduling contract.
        const adapter=new Proxy(context,{get(target,key){if(key==='state')return 'running';const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
        create(adapter).play(sound.type,{element:sound.element,intensity:.8});
      }
      const buffer=await context.startRendering(),data=buffer.getChannelData(0);let peak=0,last=0;
      for(let i=0;i<data.length;i++){if(!Number.isFinite(data[i]))throw Error('Non-finite audio');peak=Math.max(peak,Math.abs(data[i]));if(Math.abs(data[i])>.00001)last=i;}
      if(peak<.00001)throw Error('Silent audio');
      const count=Math.min(data.length,last+481),gain=.30/peak,samples=Array.from(data.slice(0,count),v=>v*gain);
      // Short end fade avoids trimming clicks.
      for(let i=Math.max(0,samples.length-240);i<samples.length;i++)samples[i]*=(samples.length-1-i)/239;
      return {samples,rate,originalPeak:peak,peak:Math.max(...samples.map(Math.abs)),duration:samples.length/rate};
    },{source:audioSource,sound});
    const data=wav(result.samples,result.rate),path=resolve(outputRoot,'Audio',sound.id+'.wav');await save(path,data);await meta(path,'audio');
    const decoded=await page.evaluate(async b64=>{
      const data=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
      const context=new OfflineAudioContext(1,48000,48000),buffer=await context.decodeAudioData(data.buffer);
      let peak=0,energy=0;for(const v of buffer.getChannelData(0)){if(!Number.isFinite(v))throw Error('Invalid decoded WAV');peak=Math.max(peak,Math.abs(v));energy+=v*v;}
      if(peak<=0||peak>=1||energy===0)throw Error('Silent or clipped WAV');
      return {channels:buffer.numberOfChannels,sampleRate:buffer.sampleRate,peak,frames:buffer.length};
    },(await readFile(path)).toString('base64'));
    audio.push({id:sound.id,resource:'MobileArt/Audio/'+sound.id,sha256:sha(data),seconds:result.duration,peak:decoded.peak,decoded,source:sound.id==='victory'?'tools/export-mobile-art.mjs':'playtest/combat-audio.js'});
  }
  for(const file of ['DoHyeon-Regular.ttf','DoHyeon-OFL.txt']){
    const out=resolve(outputRoot,'Fonts',file);await mkdir(dirname(out),{recursive:true});await copyFile(resolve(root,'playtest/assets/fonts',file),out);
  }
  const contract={version:'mobile-art-3.1-menacing-enemies',createdAt:'2026-09-28',contentVersion:JSON.parse(await readFile(resolve(root,'shared/content.json'),'utf8')).version,
    scope:'Original rounded cartoon vectors: 25 friendly appliances and five hostile robots share web and native geometry. Enemies have dark visors, slanted eyes, jagged teeth and role-specific spiked armor. No external artwork or AI bitmap input.',
    sprite:{format:'RGBA PNG',size:256,bossSize:512,pivot:[.5,.09375],pixelsPerUnit:128,framesPerState:4,filter:'Bilinear',mipmaps:false},
    units,unitStates,enemyIds:enemies,enemyStates,enemyAliases:{plated:'siege'},
    unitClipSeconds:{idle:.8,prepare:.09,fire:.10,recover:.14},enemyClipSeconds:{move:.4,hit:.12,stop:.8,destroy:.24},
    framePath:'MobileArt/Units/{definitionId}/{state}_{00..03}',enemyPath:'MobileArt/Enemies/{role}/{state}_{00..03}',
    playback:'Idle/move/stop loop. prepare/fire/recover follow authoritative lastAttackTick/lastAttackHits. hit/destroy are presentation only; do not pause movement or compute damage. Do not replay old events on resume.',
    audioBudget:{maxVoices:12,suggestedPerVoiceVolume:.2,warningPriority:true,muteRequired:true,discardOnPause:true},
    effectBudget:{decorative:48,importantReserved:16,note:'Starting mobile budget, not measured device performance.'},audio,files};
  await save(resolve(outputRoot,'contract.json'),JSON.stringify(contract,null,2)+'\n');
  await save(resolve(sourceRoot,'export-report.json'),JSON.stringify({spriteCount:files.length,audioCount:audio.length,pngAlphaBoundsValidated:true,allPngDecoded:false,audio,files},null,2)+'\n');
  // Decode the ACTUAL written PNGs, not only the source SVGs.
  let decoded=0;
  for(const f of files){const data=await readFile(resolve(outputRoot,f.path.slice('MobileArt/'.length)));await page.evaluate(async b64=>{const im=new Image();im.src='data:image/png;base64,'+b64;await im.decode();if(!im.naturalWidth)throw Error('PNG decode failed');},data.toString('base64'));decoded++;}
  const tiles=[];
  for(const u of units){const b=await readFile(resolve(outputRoot,`Units/${u.id}/idle_00.png`));tiles.push({label:`${u.id} / ${u.element} / T${u.tier}`,src:'data:image/png;base64,'+b.toString('base64')});}
  for(const enemy of enemies){const b=await readFile(resolve(outputRoot,`Enemies/${enemy}/move_00.png`));tiles.push({label:enemy,src:'data:image/png;base64,'+b.toString('base64')});}
  await page.setContent(`<body style="margin:0;background:#1b2935;color:#e7e6d9;font:14px sans-serif"><h2 style="margin:20px">SCRAP FRIENDS · CARTOON ART 03 · original vectors</h2><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:0 20px">${tiles.map(t=>`<div style="border:1px solid #405261;background:#233441;border-radius:12px;text-align:center;padding:10px"><img src="${t.src}" width="174" height="174"><div>${t.label}</div><div style="height:68px;display:flex;justify-content:center;align-items:end;gap:14px"><img src="${t.src}" width="48" height="48"><img src="${t.src}" width="64" height="64"></div></div>`).join('')}</div><p style="margin:18px">48 / 64 pixel comparisons · gameplay performance and human recognition not yet validated</p></body>`);
  await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode())));
  await page.screenshot({path:resolve(sourceRoot,'contact-sheet.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:640});
  await page.setContent(`<body style="margin:0;padding:18px;background:#233441;color:#fff4e4;font:12px sans-serif"><h2>Gameplay size · 48 px / 64 px · actual PNGs</h2><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">${tiles.map(t=>`<div style="height:105px;text-align:center;border:1px solid #455461;border-radius:12px"><div style="height:70px;display:flex;align-items:end;justify-content:center;gap:12px"><img src="${t.src}" width="48" height="48"><img src="${t.src}" width="64" height="64"></div><div>${t.label.split(' / ')[0]}</div></div>`).join('')}</div></body>`);
  await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode())));
  await page.screenshot({path:resolve(sourceRoot,'game-size-sheet.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:1000});
  // A second sheet exposes all motion poses of one family and the five enemies.
  const motion=[];
  for(const [kind,id,states] of [['Units','fire_1',unitStates],['Units','wind_1',unitStates],['Units','water_4',unitStates],...enemies.map(id=>['Enemies',id,enemyStates])])for(const state of states){
    const images=[];for(let i=0;i<4;i++)images.push((await readFile(resolve(outputRoot,`${kind}/${id}/${state}_${String(i).padStart(2,'0')}.png`))).toString('base64'));
    motion.push(`<div style="padding:6px;border-bottom:1px solid #4e5a60">${id} / ${state}<div>${images.map(b=>`<img width="90" height="90" src="data:image/png;base64,${b}">`).join('')}</div></div>`);
  }
  await page.setContent(`<body style="margin:0;padding:16px;background:#233441;color:#fff;font:14px sans-serif"><h2>Motion frames · visual only, server owns combat</h2><div style="display:grid;grid-template-columns:repeat(3,1fr)">${motion.join('')}</div></body>`);
  await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode())));await page.screenshot({path:resolve(sourceRoot,'motion-sheet.png'),fullPage:true});
  await save(resolve(sourceRoot,'export-report.json'),JSON.stringify({spriteCount:files.length,decodedPng:decoded,audioCount:audio.length,pngAlphaBoundsValidated:true,allPngDecoded:decoded===files.length,audio,files},null,2)+'\n');
  console.log(JSON.stringify({sprites:files.length,decoded,audio:audio.length,output:outputRoot}));
}finally{await browser.close();}
