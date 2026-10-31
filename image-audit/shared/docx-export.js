/* Standalone OOXML DOCX writer for the engineering photo audit.
 * No server, external CDN, third-party runtime, or HTML disguised as .doc.
 * Images are letterboxed to the same 900x600 JPEG frame for every pair.
 */
(function(global){
"use strict";
const te=new TextEncoder();
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const a="http://schemas.openxmlformats.org/drawingml/2006/main";
const pic="http://schemas.openxmlformats.org/drawingml/2006/picture";
const ct="http://schemas.openxmlformats.org/package/2006/content-types";
function u16(v){const x=new Uint8Array(2);new DataView(x.buffer).setUint16(0,v,true);return x}
function u32(v){const x=new Uint8Array(4);new DataView(x.buffer).setUint32(0,v>>>0,true);return x}
function join(parts){const n=parts.reduce((a,b)=>a+b.length,0),x=new Uint8Array(n);let o=0;for(const b of parts){x.set(b,o);o+=b.length}return x}
const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):(n>>>1);t[i]=n>>>0}return t})();
function crc32(b){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function zip(entries){
 const locals=[],centers=[];let offset=0;
 for(const [name,value] of entries){
  const n=te.encode(name),d=typeof value==="string"?te.encode(value):value,crc=crc32(d);
  const header=join([u32(0x04034b50),u16(20),u16(0x800),u16(0),u16(0),u16(33),u32(crc),u32(d.length),u32(d.length),u16(n.length),u16(0),n]);
  locals.push(header,d);
  centers.push(join([u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(0),u16(0),u16(33),u32(crc),u32(d.length),u32(d.length),u16(n.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),n]));
  offset+=header.length+d.length;
 }
 const cd=join(centers);
 const end=join([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(cd.length),u32(offset),u16(0)]);
 return new Blob([...locals,cd,end],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}
function run(t,bold=false,color="202C40",size=20){return '<w:r><w:rPr>'+(bold?'<w:b/>':'')+'<w:rFonts w:eastAsia="Microsoft JhengHei" w:ascii="Arial"/><w:color w:val="'+color+'"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">'+esc(t)+'</w:t></w:r>'}
function p(text,opts={}){
 const lines=String(text==null?"":text).split(/\r?\n/);
 const style=opts.style?'<w:pStyle w:val="'+opts.style+'"/>':'';
 const spacing='<w:spacing w:after="'+(opts.after==null?140:opts.after)+'"/>';
 const keep=opts.keep?'<w:keepNext/>':'';
 const center=opts.center?'<w:jc w:val="center"/>':'';
 const page=opts.page?'<w:pageBreakBefore/>':'';
 return '<w:p><w:pPr>'+style+spacing+keep+center+page+'</w:pPr>'+lines.map((v,i)=>(i?'<w:r><w:br/></w:r>':'')+run(v,!!opts.bold,opts.color||"202C40",opts.style==="Title"?34:(opts.bold?23:20))).join('')+'</w:p>';
}
function drawing(relId,id){
 const w=2520000,h=1680000;
 return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="100" w:after="100"/></w:pPr><w:r><w:drawing>'+
 '<wp:inline xmlns:wp="'+wp+'" distT="0" distB="0" distL="0" distR="0">'+
 '<wp:extent cx="'+w+'" cy="'+h+'"/><wp:docPr id="'+id+'" name="AuditPhoto'+id+'"/>'+
 '<a:graphic xmlns:a="'+a+'"><a:graphicData uri="'+pic+'">'+
 '<pic:pic xmlns:pic="'+pic+'"><pic:nvPicPr><pic:cNvPr id="'+id+'" name="Photo'+id+'.jpg"/><pic:cNvPicPr/></pic:nvPicPr>'+
 '<pic:blipFill><a:blip xmlns:r="'+R+'" r:embed="'+relId+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'+
 '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+w+'" cy="'+h+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'+
 '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}
function cell(content){
 return '<w:tc><w:tcPr><w:tcW w:w="4800" w:type="dxa"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tcMar></w:tcPr>'+content+'</w:tc>';
}
function table(p1,p2,img1,img2){
 const grid='<w:tblGrid><w:gridCol w:w="4800"/><w:gridCol w:w="4800"/></w:tblGrid>';
 const props='<w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="5" w:color="CBD5E1"/><w:left w:val="single" w:sz="5" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="5" w:color="CBD5E1"/><w:right w:val="single" w:sz="5" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:color="E2E8F0"/><w:insideV w:val="single" w:sz="4" w:color="E2E8F0"/></w:tblBorders></w:tblPr>';
 return '<w:tbl>'+props+grid+'<w:tr>'+cell(p(p1,{bold:true,after:30}))+cell(p(p2,{bold:true,after:30}))+'</w:tr>'+
 '<w:tr><w:trPr><w:cantSplit/></w:trPr>'+cell(img1)+cell(img2)+'</w:tr></w:tbl>';
}
function bytesFromDataUrl(d){const i=d.indexOf(",");if(i<0||!/base64/i.test(d.slice(0,i)))throw Error("Invalid JPEG data URL");const b=atob(d.slice(i+1)),a=new Uint8Array(b.length);for(let j=0;j<b.length;j++)a[j]=b.charCodeAt(j);return a}
async function imageBox(input){
 const url=typeof input==="string"?input:input?.dataUrl;
 if(!url)throw Error("Missing source image for DOCX");
 const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(Error("圖片無法載入報告"));img.src=url;});
 const c=document.createElement("canvas");c.width=900;c.height=600;
 const ctx=c.getContext("2d");if(!ctx)throw Error("無法建立圖片畫布");
 ctx.fillStyle="#ffffff";ctx.fillRect(0,0,900,600);
 const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
 const scale=Math.min(900/w,600/h),dw=Math.max(1,Math.round(w*scale)),dh=Math.max(1,Math.round(h*scale));
 ctx.imageSmoothingQuality="high";ctx.drawImage(img,(900-dw)/2,(600-dh)/2,dw,dh);
 return bytesFromDataUrl(c.toDataURL("image/jpeg",.86));
}
async function build(options){
 const pairs=[...(options.pairs||[])].sort((x,y)=>(Number(y.score)||0)-(Number(x.score)||0));
 if(!pairs.length)throw Error("沒有符合列示門檻的照片對照組");
 const entries=[],rels=[];let body="";
 const title=options.title||"工程照片交叉稽核報告";
 body+=p(title,{style:"Title",bold:true,after:240});
 body+=p("產製日期："+new Date().toLocaleString("zh-TW"),{after:120});
 const thresholdRaw=String(options.threshold??"—");const thresholdLabel=/^\d+(?:\.\d+)?$/.test(thresholdRaw)?thresholdRaw+"%":thresholdRaw;
 body+=p("照片 "+(options.photoCount||0)+" 張；跨資料夾配對 "+(options.totalPairs||0)+" 組；本報告列示 "+pairs.length+" 組；列示門檻 "+thresholdLabel+"。",{after:120});
 body+=p("分析方式："+(options.engine||"照片交叉比對")+". 數值為視覺相似度指標，不代表違規機率。請核對施工日誌、拍攝日期、契約及驗收資料。",{after:200});
 let n=0;
 for(let i=0;i<pairs.length;i++){
  const item=pairs[i];const aImg=await imageBox(item.a?.dataUrl||item.a);const bImg=await imageBox(item.b?.dataUrl||item.b);
  const idA="rId"+(++n),idB="rId"+(++n);
  entries.push(["word/media/photo"+n.toString().padStart(5,"0")+"_A.jpg",aImg]);
  rels.push('<Relationship Id="'+idA+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo'+n.toString().padStart(5,"0")+'_A.jpg"/>');
  n++;
  entries.push(["word/media/photo"+n.toString().padStart(5,"0")+"_B.jpg",bImg]);
  rels.push('<Relationship Id="'+idB+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo'+n.toString().padStart(5,"0")+'_B.jpg"/>');
  body+=p("第 "+(i+1)+" 組｜相似度 "+Number(item.score).toFixed(1)+"%",{bold:true,color:"1456A0",after:80,page:i>0});
  body+=p(item.metrics||"",{after:80});
  body+=table("A｜"+(item.a?.folder||"")+"\n"+(item.a?.name||""),"B｜"+(item.b?.folder||"")+"\n"+(item.b?.name||""),drawing(idA,n*2+1),drawing(idB,n*2+2));
  body+=p("查核比對說明與結論：",{bold:true,after:60});
  body+=p(item.analysis||"照片存在視覺相似處，仍須人工核對拍攝日期、位置及施工內容。",{after:250});
 }
 body+='<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr>';
 const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="'+W+'" xmlns:r="'+R+'" xmlns:wp="'+wp+'" xmlns:a="'+a+'" xmlns:pic="'+pic+'"><w:body>'+body+'</w:body></w:document>';
 const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="'+ct+'"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
 const rootRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
 const docRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels.join("")+'</Relationships>';
 return zip([["[Content_Types].xml",types],["_rels/.rels",rootRels],["word/document.xml",xml],["word/_rels/document.xml.rels",docRels],...entries]);
}
async function save(options){
 const blob=await build(options),name=(options.filename||"工程照片交叉稽核報告.docx").replace(/\.doc$/i,".docx");
 const url=URL.createObjectURL(blob),el=document.createElement("a");el.href=url;el.download=name;document.body.append(el);el.click();el.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 return {size:blob.size,count:options.pairs.length};
}
global.ImageAuditDocx={build,save};
})(typeof window!=="undefined"?window:globalThis);
