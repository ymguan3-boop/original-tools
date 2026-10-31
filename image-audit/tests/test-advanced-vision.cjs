/* Deterministic synthetic-only regression tests; NOT a real project validation dataset. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/advancedVision.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const W=384,H=288;
const seedPixels=(seed)=>{
 const a=new Uint8ClampedArray(W*H*4);
 let s=seed;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   s=(Math.imul(s,1664525)+1013904223)>>>0;
   const n=(s>>>24),k=(y*W+x)*4;
   const v=Math.min(255,Math.max(0,n*.8+35+Math.sin(x*.23+y*.1)*25));
   a[k]=v;a[k+1]=v;a[k+2]=v;a[k+3]=255;
 }
 return a;
};
class Canvas{
 constructor(){this.width=W;this.height=H;this.data=new Uint8ClampedArray(W*H*4)}
 getContext(){
  const c=this;
  return {
   set fillStyle(v){},
   fillRect(x,y,w,h){for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++){const k=(j*W+i)*4;c.data[k]=127;c.data[k+1]=127;c.data[k+2]=127;c.data[k+3]=255}},
   drawImage(img,...args){
    let sx=0,sy=0,sw=img.width,sh=img.height,dx=0,dy=0,dw=W,dh=H;
    if(args.length===4)[dx,dy,dw,dh]=args;
    if(args.length===8)[sx,sy,sw,sh,dx,dy,dw,dh]=args;
    for(let j=0;j<dh;j++)for(let i=0;i<dw;i++){
     const xx=Math.min(img.width-1,Math.floor(sx+i*sw/dw)),yy=Math.min(img.height-1,Math.floor(sy+j*sh/dh));
     const src=(yy*img.width+xx)*4,dst=((j+dy)*W+i+dx)*4;
     const data=img.pixels||img.data;
     c.data[dst]=data[src];c.data[dst+1]=data[src+1];c.data[dst+2]=data[src+2];c.data[dst+3]=255;
    }
   },
   getImageData(){return {data:c.data.slice()}},
   putImageData(img){c.data=img.data.slice()}
  };
 }
 toDataURL(){return 'data:image/jpeg;base64,/9j/2Q=='}
}
const fake={exports:{}};
const sandbox={module:fake,exports:fake.exports,Math,Float32Array,Uint8Array,Uint8ClampedArray,Uint16Array,console,
 document:{createElement(tag){assert.equal(tag,'canvas');return new Canvas()}},
 createImageBitmap:async(file)=>({width:W,height:H,pixels:file.pixels,close(){}})};
vm.runInNewContext(js,sandbox);
const {advancedCompare,prepareAdvanced,comparePrepared}=fake.exports;
assert.equal(typeof advancedCompare,'function');
(async()=>{
 const a={pixels:seedPixels(7)};
 const duplicate={pixels:a.pixels.slice()};
 const exact=await advancedCompare(a,duplicate);
 assert.ok(exact.matches>=12,'identical source must have adequate FAST/BRIEF correspondences');
 assert.ok(exact.inliers>=12,'identical source must have geometric inliers');
 assert.ok(exact.alignedSSIM>=99,'aligned SSIM for identical source');
 assert.equal(exact.status,'verified','identical image should be high-priority review');
 const b={pixels:seedPixels(7707)};
 const unrelated=await advancedCompare(a,b);
 assert.notEqual(unrelated.status,'verified','independent textures must not be confirmed as same source');
 const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
 assert.ok(app.includes('comparePrepared(prepared[fa]!,prepared[fb]!,false)'),'Exhaustive local geometry not wired into Start');
 assert.ok(app.includes('const prepared:(PreparedAdvanced|null)[]'),'Photo-level geometry cache missing');
 assert.ok(app.indexOf('comparePrepared(prepared[fa]!')<app.indexOf('if(score<listThreshold&&!rescued)'),'Geometry must happen BEFORE screening threshold');
 const prepared=await prepareAdvanced(a);
 const matched=comparePrepared(prepared,prepared,false);
 assert.ok(matched.inliers>=12,'Prepared vectors must match without re-decoding');
 assert.ok(prepared.sift.length>0,'SIFT-style gradients must be extracted once per file');
 assert.equal(typeof matched.overlap,'number','Geometric overlap ratio should be reported');
 assert.ok(matched.heatmap===null,'Bulk comparison must not allocate per-pair heatmaps');
 assert.ok(app.includes('localPatchScore'),'Local DINO tokens missing');
 for(const p of ['online/index.html','selector.html']){
  const html=fs.readFileSync(path.join(root,p),'utf8');
  assert.ok(html.includes('pHash')&&html.includes('RANSAC'),'Parameter documentation absent: '+p);
 }
 console.log('PASS: synthetic identical/unrelated image geometry, SSIM, UI and parameter-guide integration');
})().catch(e=>{console.error(e);process.exitCode=1});
