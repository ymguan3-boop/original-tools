/* Minimal standalone OOXML .docx writer, browser-only, no CDN or runtime deps.
 * Images are letterboxed (NOT cropped) into equal-size 640x400 JPEG canvases.
 * ZIP entries use STORE method; each file has CRC32 and UTF-8 filename flags.
 */
(function (root) {
'use strict';
const enc = new TextEncoder();
const U = (s) => enc.encode(s);
const xml = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
 .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const crcTable = new Uint32Array(256);
for (let i=0;i<256;i++) {
 let x=i;for(let j=0;j<8;j++)x=(x&1)?(0xedb88320^(x>>>1)):(x>>>1);
 crcTable[i]=x>>>0;
}
function crc32(bytes) {let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function zip(files) {
 const local=[],central=[];let offset=0;
 const h=(size,setup)=>{const b=new Uint8Array(size),v=new DataView(b.buffer);setup(v);return b;};
 for(const [filename,body] of files) {
  const name=U(filename),data=body instanceof Uint8Array?body:U(body),crc=crc32(data);
  const lh=h(30,v=>{v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);v.setUint16(8,0,true);
   v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);});
  local.push(lh,name,data);
  const ch=h(46,v=>{v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x0800,true);
   v.setUint32(16,crc,true);v.setUint32(20,data.length,true);v.setUint32(24,data.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);});
  central.push(ch,name);offset+=lh.length+name.length+data.length;
 }
 const centralSize=central.reduce((a,b)=>a+b.length,0);
 const end=h(22,v=>{v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);
  v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);});
 return new Blob([...local,...central,end],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
const T=(value,props='')=>'<w:p><w:pPr><w:spacing w:after="140"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="Microsoft JhengHei" w:ascii="Calibri"/>'+props+'</w:rPr><w:t xml:space="preserve">'+xml(value)+'</w:t></w:r></w:p>';
function dataBytes(url) {
 const raw=atob(String(url).split(',')[1]||'');
 const result=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)result[i]=raw.charCodeAt(i);
 return result;
}
async function normalizedJpeg(dataUrl,wide=false) {
 const img=new Image();
 await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('照片無法解碼'));img.src=dataUrl;});
 const W=640,H=wide?240:400,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw new Error('瀏覽器不支援 Canvas，無法製作 DOCX 圖片');
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
 const naturalW=img.naturalWidth||img.width,naturalH=img.naturalHeight||img.height;
 if(!naturalW||!naturalH)throw new Error('無法取得圖片尺寸');
 const scale=Math.min(W/naturalW,H/naturalH);
 const w=Math.max(1,Math.round(naturalW*scale)),h=Math.max(1,Math.round(naturalH*scale));
 ctx.drawImage(img,Math.round((W-w)/2),Math.round((H-h)/2),w,h);
 return dataBytes(canvas.toDataURL('image/jpeg',0.85));
}
function drawing(rel,id,name,W=2664000,H=1665000) {
 return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="20"/></w:pPr><w:r><w:drawing>'+
 '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">'+
 '<wp:extent cx="'+W+'" cy="'+H+'"/><wp:docPr id="'+id+'" name="'+xml(name)+'"/>'+
 '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'+
 '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+id+'" name="'+xml(name)+'"/><pic:cNvPicPr/></pic:nvPicPr>'+
 '<pic:blipFill><a:blip r:embed="'+rel+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'+
 '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+W+'" cy="'+H+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'+
 '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}
function photoTable(row,ids,i) {
 const w=4750;
 const cell=(name,content)=>'<w:tc><w:tcPr><w:tcW w:w="'+w+'" w:type="dxa"/><w:vAlign w:val="center"/><w:tcMar><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr>'+content+'</w:tc>';
 const left=(row.sourceA||'第一組')+'｜'+(row.filenameA||'照片 A');
 const right=(row.sourceB||'第二組')+'｜'+(row.filenameB||'照片 B');
 return '<w:tbl><w:tblPr><w:tblW w:w="9500" w:type="dxa"/><w:tblLayout w:type="fixed"/>'+
 '<w:tblBorders><w:top w:val="single" w:sz="5"/><w:left w:val="single" w:sz="5"/><w:bottom w:val="single" w:sz="5"/><w:right w:val="single" w:sz="5"/><w:insideH w:val="single" w:sz="5"/><w:insideV w:val="single" w:sz="5"/></w:tblBorders></w:tblPr>'+
 '<w:tblGrid><w:gridCol w:w="'+w+'"/><w:gridCol w:w="'+w+'"/></w:tblGrid>'+
 '<w:tr><w:trPr><w:cantSplit/></w:trPr>'+cell(left,T(left,'<w:b/>'))+cell(right,T(right,'<w:b/>'))+'</w:tr>'+
 '<w:tr><w:trPr><w:cantSplit/></w:trPr>'+cell(left,drawing(ids[0],i*2+1,left))+cell(right,drawing(ids[1],i*2+2,right))+'</w:tr></w:tbl>';
}
function groupDoc(row,i) {
 let s='';
 if(i>0)s+='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
 s+=T('#'+(i+1)+' 稽核群組','<w:b/><w:sz w:val="28"/><w:color w:val="24486B"/>');
 s+=T((row.label||'綜合相似度')+'：'+Number(row.score).toFixed(1)+'%','<w:b/><w:sz w:val="24"/><w:color w:val="C12B43"/>');
 if(row.detail)s+=T(row.detail,'<w:color w:val="64748B"/><w:sz w:val="18"/>');
 s+=photoTable(row,['rId'+(i*4+1),'rId'+(i*4+2)],i);
 if(row.featureImage){
  s+=T('【特徵點幾何對應圖】綠線表示幾何一致的局部匹配，紅線表示其他候選匹配；仍須人工核對。','<w:b/><w:color w:val="24486B"/>');
  s+=drawing('rId'+(i*4+3),i*4+3,'特徵點匹配圖',5800000,2175000);
 }
 if(row.evidenceImage){
  s+=T('【幾何對齊後差異熱區】紅色顯示有效重疊區域的差異，不能直接認定照片造假。','<w:b/><w:color w:val="24486B"/>');
  s+=drawing('rId'+(i*4+4),i*4+4,'差異熱區',5400000,3375000);
 }
 s+=T('【查核結果】'+(row.analysisSource?'（'+row.analysisSource+'）':'') ,'<w:b/><w:color w:val="24486B"/>');
 for(const line of String(row.analysis||'（尚未產生差異說明；請人工確認照片與工程資料）').split(/\r?\n/))s+=T(line,'<w:sz w:val="20"/>');
 return s;
}
async function create(input) {
 const rows=[...(input.rows||[])].sort((a,b)=>Number(b.score)-Number(a.score));
 if(!rows.length)throw new Error('沒有符合門檻的對照組，無法匯出 DOCX');
 const files=[],rels=[];let body='';
 for(let i=0;i<rows.length;i++){
  const row=rows[i],A=await normalizedJpeg(row.imageA),B=await normalizedJpeg(row.imageB);
  const left='photo'+String(i+1).padStart(4,'0')+'-A.jpeg',right='photo'+String(i+1).padStart(4,'0')+'-B.jpeg';
  files.push(['word/media/'+left,A],['word/media/'+right,B]);
  rels.push('<Relationship Id="rId'+(i*4+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/'+left+'"/>');
  rels.push('<Relationship Id="rId'+(i*4+2)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/'+right+'"/>');
  for(const [kind,key,offset] of [['feature','featureImage',3],['heatmap','evidenceImage',4]]){
   if(row[key]){
    const file='photo'+String(i+1).padStart(4,'0')+'-'+kind+'.jpeg';
    files.push(['word/media/'+file,await normalizedJpeg(row[key],kind==='feature')]);
    rels.push('<Relationship Id="rId'+(i*4+offset)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/'+file+'"/>');
   }
  }
  body+=groupDoc(row,i);
 }
 const title=input.title||'工程照片交叉稽核報告';
 const date=new Date().toLocaleString('zh-TW');
 const prefix=T(title,'<w:b/><w:sz w:val="36"/><w:color w:val="182A42"/>')+
 T('產製日期：'+date+'　｜　稽核組數：'+rows.length,'<w:color w:val="475569"/>')+
 T('分析引擎：'+(input.engine||'瀏覽器本機影像比對'),'<w:color w:val="475569"/>')+
 T('本報告之相似度為查核線索，非違規機率；請核對工程日誌、拍攝日期、契約及驗收資料。','<w:color w:val="64748B"/>')+
 T('【查核摘要】入選 '+rows.length+' 組｜'+(rows.some(r=>r.geometryStatus!=null)?('幾何高度疑似 '+rows.filter(r=>r.geometryStatus==='verified').length+' 組｜跨門檻補列 '+rows.filter(r=>r.geometryRescued).length+' 組｜原檔完全相同 '+rows.filter(r=>r.geometryStatus==='byte-identical').length+' 組'):'幾何驗證：本快速版未執行；請使用桌面版精查'),'<w:b/><w:color w:val="24486B"/>')+
 T('【判讀說明】快速分數與影像同源證據是不同指標；'+(rows.some(r=>r.geometryStatus!=null)?'照片組別若有證據圖，僅顯示局部幾何對應與差異。':'網頁版不提供 RANSAC 內點、SSIM 或幾何證據圖，不能將未執行的功能當作 0 組證據。')+'請核對原始檔與施工紀錄。','<w:color w:val="64748B"/>');
 const doc='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
 '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>'+prefix+body+
 '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="1000" w:bottom="900" w:left="1000" w:header="500" w:footer="500"/></w:sectPr></w:body></w:document>';
 const contentTypes='<?xml version="1.0" encoding="UTF-8"?>'+
 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
 '<Default Extension="xml" ContentType="application/xml"/>'+
 '<Default Extension="jpeg" ContentType="image/jpeg"/>'+
 '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
 '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'+
 '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
 const styles='<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
 '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft JhengHei"/><w:sz w:val="21"/></w:rPr></w:style></w:styles>';
 const core='<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>'+xml(title)+'</dc:title><dc:creator>工程照片交叉稽核系統</dc:creator></cp:coreProperties>';
 const relationships='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
 '<Relationship Id="rDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
 const wordRels='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
 '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+rels.join('')+'</Relationships>';
 return zip([['[Content_Types].xml',contentTypes],['_rels/.rels',relationships],['word/document.xml',doc],['word/styles.xml',styles],['word/_rels/document.xml.rels',wordRels],['docProps/core.xml',core],...files]);
}
root.ImageAuditDocx={create};
})(typeof window !== 'undefined' ? window : globalThis);
