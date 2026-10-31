/* Shared photo-comparison engine V2.2: same scoring in browser and Windows DINOv2 UI.
 * Computes a comparable visual score; DINOv2 is an independent auxiliary metric.
 * Keep all screening thresholds on compare().score, never mix cosine with this score.
 */
(function(global){'use strict';
const DCT_COS=Array.from({length:8},(_,u)=>Float64Array.from({length:32},(_,x)=>Math.cos(Math.PI*(2*x+1)*u/64)));
const clamp100=x=>Math.max(0,Math.min(100,x));
function sample(img,crop=false){
 const c=document.createElement('canvas');c.width=c.height=32;
 const cx=c.getContext('2d',{willReadFrequently:true});cx.fillStyle='#fff';cx.fillRect(0,0,32,32);
 const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height,w=crop?iw*.8:iw,h=crop?ih*.8:ih;
 cx.drawImage(img,(iw-w)/2,(ih-h)/2,w,h,0,0,32,32);
 const pixels=cx.getImageData(0,0,32,32).data,rgb=new Uint8Array(3072),gray=new Float32Array(1024),hist=new Float32Array(24);
 for(let i=0;i<1024;i++){
   const j=i*4,k=i*3,r=pixels[j],g=pixels[j+1],b=pixels[j+2];
   rgb[k]=r;rgb[k+1]=g;rgb[k+2]=b;
   hist[Math.min(7,r>>5)]++;hist[8+Math.min(7,g>>5)]++;hist[16+Math.min(7,b>>5)]++;
   gray[i]=r*.299+g*.587+b*.114;
 }
 for(let i=0;i<hist.length;i++)hist[i]/=1024;
 const hash=new Uint8Array(64);
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
   const yy=Math.min(31,Math.floor((y+.5)*4)),ax=Math.min(31,Math.floor((x+.5)*32/9)),bx=Math.min(31,Math.floor((x+1.5)*32/9));
   hash[y*8+x]=gray[yy*32+ax]>gray[yy*32+bx]?1:0;
 }
 // pHash: 2D discrete cosine transform, 8x8 low-frequency AC bits.
 const tmp=new Float64Array(256),ac=new Float64Array(64);
 for(let u=0;u<8;u++)for(let y=0;y<32;y++){
   let sum=0;for(let x=0;x<32;x++)sum+=gray[y*32+x]*DCT_COS[u][x];
   tmp[u*32+y]=sum;
 }
 for(let u=0;u<8;u++)for(let v=0;v<8;v++){
   let sum=0;for(let y=0;y<32;y++)sum+=tmp[u*32+y]*DCT_COS[v][y];
   ac[u*8+v]=sum;
 }
 const median=Array.from(ac.slice(1)).sort((a,b)=>a-b)[31];
 const phash=Uint8Array.from(ac.slice(1),v=>v>median?1:0);
 return {rgb,gray,hist,hash,phash};
}
// Local grayscale alignment: tolerate small crops, resizes and framing shifts.
// This is a spatial clue, not geometric feature-point proof.
function registeredStructure(a,b){
 let best=-1;
 for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
  let sa=0,sb=0,saa=0,sbb=0,sab=0,n=0;
  for(let y=Math.max(0,-dy);y<Math.min(32,32-dy);y++){
   for(let x=Math.max(0,-dx);x<Math.min(32,32-dx);x++){
    const av=a.gray[y*32+x],bv=b.gray[(y+dy)*32+x+dx];
    sa+=av;sb+=bv;saa+=av*av;sbb+=bv*bv;sab+=av*bv;n++;
   }
  }
  if(n<640)continue;
  const va=saa-sa*sa/n,vb=sbb-sb*sb/n;
  if(va<2500||vb<2500)continue; // reject untextured bright/gray backgrounds
  const corr=(sab-sa*sb/n)/Math.sqrt(va*vb);
  if(corr>best)best=corr;
 }
 return clamp100((best-.12)/.88*100);
}
function similarityOne(a,b){
 let diff=0,overlap=0,sameP=0,sameD=0,ma=0,mb=0;
 for(let i=0;i<3072;i++)diff+=Math.abs(a.rgb[i]-b.rgb[i]);
 for(let i=0;i<24;i++)overlap+=Math.min(a.hist[i],b.hist[i]);
 for(let i=0;i<63;i++)sameP+=a.phash[i]===b.phash[i]?1:0;
 for(let i=0;i<64;i++)sameD+=a.hash[i]===b.hash[i]?1:0;
 for(let i=0;i<1024;i++){ma+=a.gray[i];mb+=b.gray[i]}
 ma/=1024;mb/=1024;
 let cross=0,va=0,vb=0,edgeCross=0,edgeA=0,edgeB=0;
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){
   const i=y*32+x,da=a.gray[i]-ma,db=b.gray[i]-mb;
   cross+=da*db;va+=da*da;vb+=db*db;
   if(x===0||y===0||x===31||y===31)continue;
   const ax=a.gray[i+1]-a.gray[i-1],ay=a.gray[i+32]-a.gray[i-32];
   const bx=b.gray[i+1]-b.gray[i-1],by=b.gray[i+32]-b.gray[i-32];
   edgeCross+=ax*bx+ay*by;edgeA+=ax*ax+ay*ay;edgeB+=bx*bx+by*by;
 }
 const pix=100*(1-diff/(3072*255)),hash=100*sameP/63,col=100*overlap/3;
 const dhash=100*sameD/64;
 const corr=va>1&&vb>1?cross/Math.sqrt(va*vb):0;
 const edgeCorr=edgeA>1&&edgeB>1?edgeCross/Math.sqrt(edgeA*edgeB):0;
 const structure=clamp100((corr-.12)/.88*100),edges=clamp100((edgeCorr-.1)/.9*100);
 const pEvidence=clamp100((hash-55)/45*100),dEvidence=clamp100((dhash-55)/45*100);
 let score=.38*pEvidence+.33*structure+.18*edges+.11*dEvidence;
 // Exclude lookalike lightness/color distributions unless spatial structure matches.
 if(!(pEvidence>=62&&structure>=52&&edges>=42))score=Math.min(score,59);
 else if(!(pEvidence>=76&&structure>=68&&edges>=60))score=Math.min(score,82);
 // Global perceptual hashes can fluctuate on almost-identical low-detail scenes.
 if(structure>=96&&edges>=94)score=Math.max(score, .53*structure+.47*edges-2);
 if(pix>=99.9&&hash>=98&&structure>=98)score=100;
 return {score:Math.round(clamp100(score)*10)/10,pix,hash,col,structure,edges,dhash};
}
function compare(a,b){
 const full=similarityOne(a.full,b.full),center=similarityOne(a.center,b.center);
 const winner=center.score*.97>full.score?{...center,score:Math.round(center.score*9.7)/10,area:'中心裁切'}:{...full,area:'全圖'};
 // Don't let harsh edge thresholds hide photos with consistent content/layout.
 const reg=Math.max(registeredStructure(a.full,b.full),registeredStructure(a.center,b.center));
 const strongEvidence=(winner.pix>=87&&winner.hash>=76&&
  (winner.structure>=68||reg>=76)&&(winner.edges>=25||reg>=83))||
  (winner.pix>=84&&reg>=90&&winner.hash>=72);
 if(strongEvidence){
  const corroborated=80+.23*(winner.hash-70)+.12*(winner.structure-60)+
   .11*(reg-60)+.07*(winner.pix-85);
  winner.score=Math.round(clamp100(Math.max(winner.score,Math.min(97,corroborated)))*10)/10;
 }
 return {...winner,registered:Math.round(reg*10)/10,strongEvidence};
}

function rule(m){
 const head='綜合視覺查核指標 '+m.score.toFixed(1)+'%（非統計機率）｜pHash '+m.hash.toFixed(1)+'%｜結構 '+m.structure.toFixed(1)+'%｜邊緣 '+m.edges.toFixed(1)+'%｜位置校正 '+m.registered.toFixed(1)+'%｜像素 '+m.pix.toFixed(1)+'%（輔助）。';
 let conclusion;
 if(m.strongEvidence){
  conclusion='多項證據顯示主體與畫面布局接近，屬高度疑似同源照片，應優先核對原始檔；裁切、重新壓縮或不同邊框都可能降低單項指標，不能因原始綜合分數較低而直接排除。';
 }else if(m.score>=75||(m.hash>=75&&m.pix>=85)){
  conclusion='照片存在相同場景或來源重用疑點，仍需人工檢視細節、拍攝時間與取景差異。';
 }else{
  conclusion='目前證據尚不足以判定兩張影像是否同源；此結果不代表已確認為不同照片或可排除工程異常。';
 }
 return '1. 差異度說明：'+head+
 '\\n2. 查核研判：'+conclusion+
 '\\n3. 建議查證：取得原始照片／EXIF、拍攝日期、施工位置、施工日誌、估驗計價與驗收資料。相似度不代表違規機率，不得只憑影像認定重複請款。';
}

global.ImageAuditComparator={version:'2.2.0',sample,compare,similarityOne,registeredStructure,rule};
})(typeof window!=='undefined'?window:globalThis);
