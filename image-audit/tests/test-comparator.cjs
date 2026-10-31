/* Regression tests for standalone browser comparators, without installing dependencies. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
function pixels(fn) {
 const data=new Uint8ClampedArray(32*32*4);
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const c=fn(x,y),p=(y*32+x)*4;
  data[p]=c[0];data[p+1]=c[1];data[p+2]=c[2];data[p+3]=255;
 }
 return {naturalWidth:32,naturalHeight:32,pixels:data};
}
function image(mode){
 return pixels((x,y)=>{
   let v=0;
   if(mode==='A'||mode==='A-noisy'){
     v=(x<16?60:200)+(y>18?-40:0)+(x>9&&x<22&&y>9&&y<26?55:0);
     if(mode==='A-noisy')v=v*.95+5+((x*17+y*31)%7-3);
   } else if(mode==='B'){
     v=(y<16?60:200)+(x>18?-40:0)+(x>9&&x<22&&y>9&&y<26?55:0);
   } else if(mode==='flat'){v=110;}
   else if(mode==='flat-other'){v=155;}
   v=Math.max(0,Math.min(255,v));
   return [v,v,v];
 });
}
function loadComparator(file){
 const html=fs.readFileSync(file,'utf8');
 const start=html.indexOf('const DCT_COS=');
 const end=html.indexOf('function progress(n,total,stage)',start);
 assert.ok(start>0&&end>start, 'multi-evidence function missing: '+file);
 const script=html.slice(start,end);
 const mock={
  console, Uint8Array,Uint8ClampedArray,Float32Array,Float64Array,Array,Math,
  document:{createElement(){
   let current=null;
   return {set width(n){},set height(n){},getContext(){return {
    fillRect(){},drawImage(img){current=img;},
    getImageData(){return {data:current.pixels}}
   }}};
  }}
 };
 const f=vm.runInNewContext(script+'\n({sample,similarityOne,compare,registeredStructure})',mock);
 return f;
}
for(const file of [path.join(ROOT,'online/index.html'),path.join(ROOT,'offline/工程照片交叉稽核系統.html')]){
 const f=loadComparator(file);
 const sample=(name)=>f.sample(image(name));
 const a=sample('A'),noisy=sample('A-noisy'),b=sample('B'),flat=sample('flat'),other=sample('flat-other');
 const identical=f.similarityOne(a,a);
  const registered=f.registeredStructure(a,a);
  const flatRegistered=f.registeredStructure(flat,other);
  const composite=f.compare({full:a,center:a},{full:noisy,center:noisy});
 const near=f.similarityOne(a,noisy);
 const unrelated=f.similarityOne(a,b);
 const flatUnrelated=f.similarityOne(flat,other);
 console.log(path.relative(ROOT,file),{identical:identical.score,near:near.score,unrelated:unrelated.score,flatUnrelated:flatUnrelated.score});
 assert.ok(identical.score>=99.9,'exact duplicate should be 100');
  assert.ok(registered>=99,'fully aligned photo must score high');
  assert.ok(flatRegistered<50,'flat scenes must not have geometrical evidence');
  assert.ok(composite.score>=85,'near-identical photos should not be missed by primary screening');
  assert.ok(composite.strongEvidence,'near-identical photos should warrant priority review');
 assert.ok(near.score>=88,'near-identical images with small brightness/noise changes must score high');
 assert.ok(near.score>unrelated.score+25,'near-duplicates must be distinguishable');
 assert.ok(unrelated.score<78,'different image structures must not be misclassified at 78%');
 assert.ok(flatUnrelated.score<78,'flat images with different brightness must not be falsely flagged');
 assert.ok(Number.isFinite(near.score)&&Number.isFinite(unrelated.score));
}
