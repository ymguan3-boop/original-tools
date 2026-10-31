/* All data is generated in memory: no user photos stored or committed. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function makeImage(w,h,pattern){
 const p=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const v=pattern(x,y),i=(y*w+x)*4;
  p[i]=p[i+1]=p[i+2]=v;p[i+3]=255;
 }
 return {width:w,height:h,naturalWidth:w,naturalHeight:h,pixels:p};
}
function canvas(){
 let w=0,h=0,p=new Uint8ClampedArray(0);
 const c={
  set width(x){w=x;p=new Uint8ClampedArray(w*h*4)},get width(){return w},
  set height(x){h=x;p=new Uint8ClampedArray(w*h*4)},get height(){return h},
  getContext(){return{
   set fillStyle(v){this.color=v},get fillStyle(){return this.color},
   fillRect(x,y,a,b){
    const v=this.color==='#fff'||this.color==='#ffffff'?255:127;
    for(let j=y;j<y+b;j++)for(let i=x;i<x+a;i++){
     const k=(j*w+i)*4;p[k]=p[k+1]=p[k+2]=v;p[k+3]=255;
    }
   },
   drawImage(img,...a){
    let sx=0,sy=0,sw=img.width,sh=img.height,dx=0,dy=0,dw=img.width,dh=img.height;
    if(a.length===4)[dx,dy,dw,dh]=a;
    else if(a.length===8)[sx,sy,sw,sh,dx,dy,dw,dh]=a;
    for(let j=0;j<dh;j++)for(let i=0;i<dw;i++){
     const x0=Math.max(0,Math.min(img.width-1,Math.floor(sx+i*sw/dw)));
     const y0=Math.max(0,Math.min(img.height-1,Math.floor(sy+j*sh/dh)));
     const source=(y0*img.width+x0)*4,output=((j+dy)*w+i+dx)*4;
     if(output<0||output+3>=p.length)continue;
     p[output]=img.pixels[source];p[output+1]=img.pixels[source+1];
     p[output+2]=img.pixels[source+2];p[output+3]=255;
    }
   },
   getImageData(){return {data:p.slice()}}
  }}
 };
 return c;
}
const scope={window:null,document:{createElement:()=>canvas()},Uint8Array,Uint8ClampedArray,Float32Array,Float64Array,Math,Array};
scope.window=scope;
vm.runInNewContext(fs.readFileSync(path.join(root,'shared/comparator-core.js'),'utf8'),scope);
const c=scope.ImageAuditComparator;
assert.equal(c.version,'2.5.0');
const scene=(x,y)=>x>18&&x<70&&y>12&&y<54?Math.round((x*19+y*31)%135+35):
 x<35&&y>33?35:x>75&&y<32?230:100;
const original=makeImage(100,80,scene);
const padded=makeImage(180,160,(x,y)=>x>=40&&x<140&&y>=40&&y<120?scene(x-40,y-40):255);
const different=makeImage(100,80,(x,y)=>((x*3+y*5)%60)+160);
assert.equal(c.whiteBounds(original),null,'Non-bordered source must be left intact');
const bounds=c.whiteBounds(padded);
assert.ok(bounds,'Expected to identify external white paper frame');
assert.ok(bounds.x>.15&&bounds.y>.1,'Border crop should not include paper edge');
const a=c.prepare(original),b=c.prepare(padded),d=c.prepare(different);
assert.ok(b.trimmed&&b.borderTrimmed,'Trimmed descriptors should be available');
assert.ok(!a.borderTrimmed,'Do not strip valid image content');
const raw=c.compare({full:a.full,center:a.center},{full:b.full,center:b.center});
const improved=c.compare(a,b);
const negative=c.compare(a,d);
assert.ok(improved.score>=raw.score+5,'Multiregion should improve border-padded matches');
assert.ok(improved.score>negative.score+10,'Unrelated content should remain distinguishable');
assert.ok(improved.area.includes('白邊')||improved.strongEvidence,'Best match should use border crop or strong corroboration');
for(const file of ['online/index.html','offline/工程照片交叉稽核系統.html']){
 const src=fs.readFileSync(path.join(root,file),'utf8');
 assert.ok(src.includes('ImageAuditComparator.prepare(bitmap)'),'Browser not using canonical multi-region prepare');
}
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
assert.ok(app.includes('common.prepare(bitmap)'),'Desktop not using same preprocessor');
console.log('PASS: conservative external paper trim, multi-region improvements, negative separation and app parity');
