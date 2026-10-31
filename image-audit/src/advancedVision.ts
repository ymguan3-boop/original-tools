/**
 * Optional, on-demand local forensic screening, never used as the shared score.
 * FAST corners + oriented 128-bit BRIEF descriptors; mutual ratio matching;
 * two-point similarity-transform RANSAC (rotation / scale / translation);
 * 8x8 local-window SSIM and registered pixel difference overlay.
 *
 * Not equivalent to OpenCV ORB or projective homography verification.
 * All statistics are screening evidence, not duplicate/violation probabilities.
 */
export interface AdvancedResult {
  status:'verified'|'review'|'inconclusive'|'byte-identical';
  label:string;
  matches:number;
  inliers:number;
  inlierRatio:number;
  coverage:number;
  alignedSSIM:number|null;
  differenceArea:number|null;
  heatmap:string|null;
  note:string;
  patchSimilarity?:number|null;
  method?:'FAST / BRIEF'|'多尺度 SIFT-style 梯度描述子'|'SHA-256';
  overlap?:number|null;
  siftMatches?:number;
}
type Frame={w:number;h:number;gray:Float32Array;mask:Uint8Array;canvas:HTMLCanvasElement};
type Point={x:number;y:number;score:number;desc:Uint8Array};
type Pair={a:Point;b:Point;distance:number};

type SiftPoint=Point & {gradient:Float32Array};
/* A self-contained, patent-free SIFT-style descriptor fallback. It is NOT a
 * binary-compatible OpenCV SIFT implementation: it uses multi-radius oriented
 * 4x4x8 gradient histograms, normalization and nearest-neighbour ratio tests.
 * It adds no downloads, credentials, or runtime dependency to the Windows EXE. */
function siftFeatures(frame:Frame):SiftPoint[]{
 const g=frame.gray,m=frame.mask,w=frame.w,h=frame.h;
 const candidates:{x:number;y:number;energy:number}[]=[];
 for(let y=20;y<h-20;y+=6)for(let x=20;x<w-20;x+=6){
  if(!m[y*w+x])continue;
  let energy=0,mean=0,meanSq=0,n=0;
  for(let j=-3;j<=3;j+=2)for(let i=-3;i<=3;i+=2){
   const v=g[(y+j)*w+x+i],dx=g[(y+j)*w+x+i+1]-g[(y+j)*w+x+i-1],
     dy=g[(y+j+1)*w+x+i]-g[(y+j-1)*w+x+i];
   energy+=Math.abs(dx)+Math.abs(dy);mean+=v;meanSq+=v*v;n++;
  }
  const variance=meanSq/n-(mean/n)**2;
  if(energy>400&&variance>130)candidates.push({x,y,energy:energy*Math.sqrt(variance)});
 }
 candidates.sort((a,b)=>b.energy-a.energy);
 const chosen:SiftPoint[]=[];
 function descriptor(x:number,y:number,r:number):Float32Array|null{
  const hist=new Float32Array(128);
  let mx=0,my=0;
  for(let j=-3*r;j<=3*r;j+=r)for(let i=-3*r;i<=3*r;i+=r){
   const px=x+i,py=y+j;
   mx+=g[py*w+px+1]-g[py*w+px-1];my+=g[(py+1)*w+px]-g[(py-1)*w+px];
  }
  const angle=Math.atan2(my,mx),cs=Math.cos(angle),sn=Math.sin(angle);
  let total=0;
  for(let cellY=0;cellY<4;cellY++)for(let cellX=0;cellX<4;cellX++)
   for(let iy=0;iy<4;iy++)for(let ix=0;ix<4;ix++){
    const u=((cellX*4+ix)-7.5)*r, v=((cellY*4+iy)-7.5)*r;
    const xx=Math.round(x+cs*u-sn*v),yy=Math.round(y+sn*u+cs*v);
    if(xx<2||xx>=w-2||yy<2||yy>=h-2||!m[yy*w+xx])continue;
    const dx=g[yy*w+xx+1]-g[yy*w+xx-1],dy=g[(yy+1)*w+xx]-g[(yy-1)*w+xx];
    const mag=Math.hypot(dx,dy),rot=(Math.atan2(dy,dx)-angle+Math.PI*4)%(Math.PI*2);
    const bin=Math.min(7,Math.floor(rot*8/(Math.PI*2)));
    const gauss=Math.exp(-(u*u+v*v)/(2*(8*r)**2));
    hist[(cellY*4+cellX)*8+bin]+=mag*gauss;
    total+=mag;
   }
  if(total<180)return null;
  let norm=Math.hypot(...hist);if(norm<1e-6)return null;
  for(let i=0;i<128;i++)hist[i]=Math.min(.2,hist[i]/norm);
  norm=Math.hypot(...hist);for(let i=0;i<128;i++)hist[i]/=norm||1;
  return hist;
 }
 for(const v of candidates){
  if(chosen.length>=135)break;
  if(chosen.some(p=>Math.abs(p.x-v.x)<8&&Math.abs(p.y-v.y)<8))continue;
  const radii=[1,2,3];
  for(const r of radii){
   if(v.x<16*r+2||v.y<16*r+2||v.x>w-16*r-3||v.y>h-16*r-3)continue;
   const gradient=descriptor(v.x,v.y,r);
   if(gradient){chosen.push({x:v.x,y:v.y,score:v.energy,desc:new Uint8Array(16),gradient});break}
  }
 }
 return chosen;
}
function matchSift(a:SiftPoint[],b:SiftPoint[]):Pair[]{
 const forward=new Map<number,{j:number;d:number}>(),reverse=new Map<number,number>();
 const dist=(p:SiftPoint,q:SiftPoint)=>{
  let dot=0;for(let k=0;k<128;k++)dot+=p.gradient[k]*q.gradient[k];
  return Math.max(0,2-2*dot);
 };
 for(let i=0;i<a.length;i++){
  let first=Infinity,second=Infinity,j=-1;
  for(let k=0;k<b.length;k++){
   const d=dist(a[i],b[k]);if(d<first){second=first;first=d;j=k}else if(d<second)second=d;
  }
  if(j>=0&&first<.72&&first<.72*second)forward.set(i,{j,d:first});
 }
 for(let j=0;j<b.length;j++){
  let first=Infinity,idx=-1;
  for(let i=0;i<a.length;i++){const d=dist(a[i],b[j]);if(d<first){first=d;idx=i}}
  reverse.set(j,idx);
 }
 return [...forward.entries()].filter(([i,v])=>reverse.get(v.j)===i)
   .map(([i,v])=>({a:a[i],b:b[v.j],distance:v.d}));
}

export interface PreparedAdvanced {frame:Frame;points:Point[];sift:SiftPoint[];}
/** Decode and build keypoint descriptors ONCE per uploaded photo, not per pair. */
export async function prepareAdvanced(file:File):Promise<PreparedAdvanced>{const frame=await decode(file);return {frame,points:corners(frame),sift:siftFeatures(frame)}}
const WIDTH=384,HEIGHT=288, CIRCLE=[[0,-3],[1,-3],[2,-2],[3,-1],[3,0],[3,1],[2,2],[1,3],[0,3],[-1,3],[-2,2],[-3,1],[-3,0],[-3,-1],[-2,-2],[-1,-3]];
const PATTERN:(readonly [number,number,number,number])[]=(()=>{
  let seed=0x2ee15b32;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
  return Array.from({length:128},()=>[Math.round((rand()-.5)*24),Math.round((rand()-.5)*24),Math.round((rand()-.5)*24),Math.round((rand()-.5)*24)] as const);
})();
async function decode(file:File):Promise<Frame>{
 const img=await createImageBitmap(file);
 try{
  const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;
  const c=canvas.getContext('2d',{willReadFrequently:true});if(!c)throw new Error('無法建立本機影像畫布');
  c.fillStyle='#7f7f7f';c.fillRect(0,0,WIDTH,HEIGHT);
  // Prefer the exact same conservative white-margin detector as the shared web comparator.
  const bounds=(window as Window & {ImageAuditComparator?:{whiteBounds?:(image:ImageBitmap)=>{x:number;y:number;w:number;h:number}|null}}).ImageAuditComparator?.whiteBounds?.(img);
  const source=bounds||{x:0,y:0,w:1,h:1};
  const sw=img.width*source.w,sh=img.height*source.h;
  const sc=Math.min(WIDTH/sw,HEIGHT/sh),w=Math.round(sw*sc),h=Math.round(sh*sc);
  const x=Math.floor((WIDTH-w)/2),y=Math.floor((HEIGHT-h)/2);
  c.drawImage(img,img.width*source.x,img.height*source.y,sw,sh,x,y,w,h);
  const rgba=c.getImageData(0,0,WIDTH,HEIGHT).data,g=new Float32Array(WIDTH*HEIGHT),mask=new Uint8Array(g.length);
  for(let j=0;j<HEIGHT;j++)for(let i=0;i<WIDTH;i++){
   const p=j*WIDTH+i,k=p*4;g[p]=.299*rgba[k]+.587*rgba[k+1]+.114*rgba[k+2];
   mask[p]=(i>=x&&i<x+w&&j>=y&&j<y+h)?1:0;
  }
  return {w:WIDTH,h:HEIGHT,gray:g,mask,canvas};
 }finally{img.close()}
}
function corners(f:Frame):Point[]{
 const {gray:g,mask:m,w,h}=f,candidates:{x:number;y:number;score:number}[]=[];
 for(let y=17;y<h-17;y+=2)for(let x=17;x<w-17;x+=2){
  if(!m[y*w+x])continue;
  const v=g[y*w+x];let bright=0,dark=0,best=0;
  const diffs=CIRCLE.map(([dx,dy])=>g[(y+dy)*w+x+dx]-v);
  for(let i=0;i<24;i++){
   const d=diffs[i%16];bright=d>21?bright+1:0;dark=d< -21?dark+1:0;best=Math.max(best,bright,dark);
  }
  if(best<9)continue;
  const dx=g[y*w+x+1]-g[y*w+x-1],dy=g[(y+1)*w+x]-g[(y-1)*w+x];
  const score=Math.hypot(dx,dy)+diffs.reduce((a,b)=>a+Math.abs(b),0)/5;
  candidates.push({x,y,score});
 }
 candidates.sort((a,b)=>b.score-a.score);
 const chosen:Point[]=[];
 for(const v of candidates){
  if(chosen.length>=260)break;
  if(chosen.some(q=>Math.abs(q.x-v.x)<8&&Math.abs(q.y-v.y)<8))continue;
  // Brief orientation is a local image gradient estimate; this is not canonical ORB.
  const gx=g[v.y*w+v.x+4]-g[v.y*w+v.x-4];
  const gy=g[(v.y+4)*w+v.x]-g[(v.y-4)*w+v.x];
  const angle=Math.atan2(gy,gx),cs=Math.cos(angle),sn=Math.sin(angle),bits=new Uint8Array(16);
  for(let k=0;k<PATTERN.length;k++){
   const [ax,ay,bx,by]=PATTERN[k];
   const x1=Math.max(0,Math.min(w-1,Math.round(v.x+ax*cs-ay*sn))),y1=Math.max(0,Math.min(h-1,Math.round(v.y+ax*sn+ay*cs)));
   const x2=Math.max(0,Math.min(w-1,Math.round(v.x+bx*cs-by*sn))),y2=Math.max(0,Math.min(h-1,Math.round(v.y+bx*sn+by*cs)));
   if(g[y1*w+x1]<g[y2*w+x2])bits[k>>3]|=1<<(k&7);
  }
  chosen.push({...v,desc:bits});
 }
 return chosen;
}
function hamming(a:Uint8Array,b:Uint8Array){
 let n=0;for(let i=0;i<16;i++){let x=a[i]^b[i];while(x){x&=x-1;n++}}return n
}
function match(pa:Point[],pb:Point[]):Pair[]{
 const forwards=new Map<number,{j:number;d:number}>(),backwards=new Map<number,number>();
 for(let i=0;i<pa.length;i++){
  let first=129,second=129,j=-1;
  for(let k=0;k<pb.length;k++){const d=hamming(pa[i].desc,pb[k].desc);if(d<first){second=first;first=d;j=k}else if(d<second)second=d}
  if(first<=52&&first<.82*second&&j>=0)forwards.set(i,{j,d:first});
 }
 for(let j=0;j<pb.length;j++){
  let min=129,idx=-1;for(let i=0;i<pa.length;i++){const d=hamming(pb[j].desc,pa[i].desc);if(d<min){min=d;idx=i}}backwards.set(j,idx);
 }
 return [...forwards.entries()].filter(([i,v])=>backwards.get(v.j)===i).map(([i,v])=>({a:pa[i],b:pb[v.j],distance:v.d}));
}
type Similarity={scale:number;cs:number;sn:number;tx:number;ty:number};
function transform(a:Point,b:Point,c:Point,d:Point):Similarity|null{
 const ux=c.x-a.x,uy=c.y-a.y,vx=d.x-b.x,vy=d.y-b.y;
 const den=ux*ux+uy*uy;if(den<150)return null;
 const r=(ux*vx+uy*vy)/den,im=(ux*vy-uy*vx)/den,scale=Math.hypot(r,im);
 if(scale<.35||scale>3)return null;
 return {scale,cs:r,sn:im,tx:b.x-r*a.x+im*a.y,ty:b.y-im*a.x-r*a.y};
}
function inlier(model:Similarity,p:Pair):boolean{
 const x=model.cs*p.a.x-model.sn*p.a.y+model.tx;
 const y=model.sn*p.a.x+model.cs*p.a.y+model.ty;
 return (x-p.b.x)**2+(y-p.b.y)**2<18;
}
function ransac(pairs:Pair[]):{model:Similarity|null;inlierPairs:Pair[]}{
 if(pairs.length<3)return {model:null,inlierPairs:[]};
 let best:Pair[]=[],bestModel:Similarity|null=null;
 let seed=0x35c5aa17;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 const trials=Math.min(450,Math.max(100,pairs.length*6));
 for(let t=0;t<trials;t++){
  const i=Math.floor(rnd()*pairs.length),j=Math.floor(rnd()*pairs.length);
  if(i===j)continue;
  const model=transform(pairs[i].a,pairs[i].b,pairs[j].a,pairs[j].b);
  if(!model)continue;
  const good=pairs.filter(p=>inlier(model,p));
  if(good.length>best.length){best=good;bestModel=model}
 }
 // Refit using 2D similarity least squares to avoid ambiguous 2-point solutions.
 if(best.length>=3){
  const n=best.length,ma=best.reduce((v,p)=>v+p.a.x,0)/n,mb=best.reduce((v,p)=>v+p.a.y,0)/n;
  const na=best.reduce((v,p)=>v+p.b.x,0)/n,nb=best.reduce((v,p)=>v+p.b.y,0)/n;
  let den=0,re=0,im=0;
  for(const p of best){const x=p.a.x-ma,y=p.a.y-mb,u=p.b.x-na,v=p.b.y-nb;den+=x*x+y*y;re+=x*u+y*v;im+=x*v-y*u}
  if(den>1){re/=den;im/=den;const scale=Math.hypot(re,im);
   if(scale>=.35&&scale<=3){
    bestModel={scale,cs:re,sn:im,tx:na-re*ma+im*mb,ty:nb-im*ma-re*mb};
    best=pairs.filter(p=>inlier(bestModel!,p));
   }
  }
 }
 return {model:bestModel,inlierPairs:best};
}
function registeredSSIM(a:Frame,b:Frame,model:Similarity,includeHeatmap=true){
 // 8x8 blocks; standard luminance+contrast+covariance SSIM, geometric overlap only.
 const W=a.w,H=a.h,c1=6.5025,c2=58.5225,gA=a.gray,gB=b.gray;
 let heat:HTMLCanvasElement|null=null,ctx:CanvasRenderingContext2D|null=null,overlay:ImageData|null=null;
 if(includeHeatmap){heat=document.createElement('canvas');heat.width=W;heat.height=H;ctx=heat.getContext('2d');if(!ctx)throw Error('差異畫布建立失敗');ctx.drawImage(a.canvas,0,0);overlay=ctx.getImageData(0,0,W,H)}
 const px=overlay?.data;
 let blocks=0,totalSSIM=0,diffCount=0,pixelCount=0;
 for(let by=0;by<H;by+=8)for(let bx=0;bx<W;bx+=8){
  let aa=0,bb=0,aaa=0,bbb=0,ab=0,n=0;
  for(let j=by;j<Math.min(H,by+8);j++)for(let i=bx;i<Math.min(W,bx+8);i++){
   const x=model.cs*i-model.sn*j+model.tx,y=model.sn*i+model.cs*j+model.ty;
   const kx=Math.round(x),ky=Math.round(y);
   if(kx<0||kx>=W||ky<0||ky>=H||!a.mask[j*W+i]||!b.mask[ky*W+kx])continue;
   const va=gA[j*W+i],vb=gB[ky*W+kx],p=(j*W+i)*4;
   aa+=va;bb+=vb;aaa+=va*va;bbb+=vb*vb;ab+=va*vb;n++;pixelCount++;
   const delta=Math.abs(va-vb);if(delta>32)diffCount++;
   if(delta>27&&px){px[p]=250;px[p+1]=Math.round(px[p+1]*.25);px[p+2]=Math.round(px[p+2]*.25);px[p+3]=255}
  }
  if(n<32)continue;
  const muA=aa/n,muB=bb/n,va=Math.max(0,aaa/n-muA*muA),vb=Math.max(0,bbb/n-muB*muB),cov=ab/n-muA*muB;
  const s=((2*muA*muB+c1)*(2*cov+c2))/((muA*muA+muB*muB+c1)*(va+vb+c2));
  totalSSIM+=Math.max(-1,Math.min(1,s));blocks++;
 }
 if(blocks<40||pixelCount<2000)return {ssim:null,differenceArea:null,overlap:null,heatmap:null};
 if(ctx&&overlay)ctx.putImageData(overlay,0,0);
 return {ssim:Math.round(10000*Math.max(0,totalSSIM/blocks))/100,differenceArea:Math.round(10000*diffCount/pixelCount)/100,overlap:Math.round(pixelCount/Math.min(a.mask.reduce((n,v)=>n+v,0),b.mask.reduce((n,v)=>n+v,0))*1000)/10,heatmap:heat?.toDataURL('image/jpeg',.75)??null};
}
/** Per-pair comparison using precomputed FAST/BRIEF and oriented gradient descriptors. */
export function comparePrepared(aPrepared:PreparedAdvanced,bPrepared:PreparedAdvanced,includeHeatmap=false):AdvancedResult{
 const a=aPrepared.frame,b=bPrepared.frame;
 function calculate(pairs:Pair[],method:AdvancedResult['method']):AdvancedResult{
  const geom=ransac(pairs),inliers=geom.inlierPairs.length,ratio=pairs.length?inliers/pairs.length:0;
  let coverage=0;
  if(inliers>=4){
   const xs=geom.inlierPairs.map(p=>p.a.x),ys=geom.inlierPairs.map(p=>p.a.y);
   coverage=((Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys)))/(WIDTH*HEIGHT);
  }
  const aligned=geom.model&&inliers>=4?registeredSSIM(a,b,geom.model,includeHeatmap):
   {ssim:null,differenceArea:null,overlap:null,heatmap:null};
  let status:AdvancedResult['status']='inconclusive',label='幾何證據不足';
  if(inliers>=12&&ratio>=.48&&coverage>=.06&&aligned.ssim!==null&&aligned.ssim>=67&&
     aligned.overlap!==null&&aligned.overlap>=20){
    status='verified';label='高度疑似同一來源影像，優先查證';
  }else if(inliers>=7&&ratio>=.3&&coverage>=.025){status='review';label='存在幾何對應，建議人工複核'}
  return {status,label,method,matches:pairs.length,inliers,inlierRatio:Math.round(1000*ratio)/10,
   coverage:Math.round(10000*coverage)/100,
   alignedSSIM:aligned.ssim,differenceArea:aligned.differenceArea,overlap:aligned.overlap,heatmap:aligned.heatmap,
   note:status==='verified'?'局部幾何和對齊結構支持疑似同源；仍須核對原圖及工程資料。':
    status==='review'?'部分特徵一致，但尚不能確認同源。':
    '特徵點不足、裁切或拍攝角度可能降低匹配；無法據此判定照片不同。'};
 }
 const fast=calculate(match(aPrepared.points,bPrepared.points),'FAST / BRIEF');
 // Full-scan FAST always runs. SIFT-style descriptor fallback runs when
 // FAST alone is inconclusive or cannot verify the pair.
 if(fast.status==='verified'||!aPrepared.sift?.length||!bPrepared.sift?.length)return fast;
 const pairs=matchSift(aPrepared.sift,bPrepared.sift);
 const gradient=calculate(pairs,'多尺度 SIFT-style 梯度描述子');
 gradient.siftMatches=pairs.length;
 const rank=(x:AdvancedResult)=>x.status==='verified'?3:x.status==='review'?2:1;
 if(rank(gradient)>rank(fast)||rank(gradient)===rank(fast)&&gradient.inliers>fast.inliers)return gradient;
 fast.siftMatches=pairs.length;
 return fast;
}

/** Standalone inspector may still process an arbitrary pair on demand. */
export async function advancedCompare(fileA:File,fileB:File):Promise<AdvancedResult>{
 const [a,b]=await Promise.all([prepareAdvanced(fileA),prepareAdvanced(fileB)]);
 return comparePrepared(a,b,true);
}
