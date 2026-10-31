const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'shared/docx-export.js'),'utf8');
const tinyImage='data:image/jpeg;base64,/9j/2Q==';
const sandbox={TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,Blob,atob,console,setTimeout,URL:{
 createObjectURL(){return'blob:mock'},revokeObjectURL(){}
 }};
sandbox.window=sandbox;
sandbox.Image=class FakeImage{
 constructor(){this.naturalWidth=1200;this.naturalHeight=800;}
 set src(v){if(!v)throw Error('Empty image');Promise.resolve().then(()=>this.onload())}
};
sandbox.document={createElement(tag){
 if(tag==='canvas')return {width:900,height:600,getContext(){return{fillRect(){},drawImage(){},set fillStyle(v){},set imageSmoothingQuality(v){}}},toDataURL(){return tinyImage}};
 return {click(){},remove(){},set href(v){},set download(v){}};
},body:{append(){}}};
vm.runInNewContext(js,sandbox,{timeout:3000});
assert.equal(typeof sandbox.ImageAuditDocx.build,'function');
function readZip(blob){
 return blob.arrayBuffer().then(buf=>{
 const b=new Uint8Array(buf),v=new DataView(buf),files={};let p=0;
 while(p+30<b.length&&v.getUint32(p,true)===0x04034b50){
  const size=v.getUint32(p+18,true),nameLen=v.getUint16(p+26,true),extra=v.getUint16(p+28,true);
  const name=new TextDecoder().decode(b.subarray(p+30,p+30+nameLen));
  const at=p+30+nameLen+extra;
  files[name]=b.slice(at,at+size);p=at+size;
 }
 return files;
 });
}
(async()=>{
 const pairs=[
  {score:71.1,a:{folder:'工區A',name:'低相似度.jpg',dataUrl:tinyImage},b:{folder:'B',name:'照片02.jpg',dataUrl:tinyImage},analysis:'低分組說明'},
  {score:96.5,a:{folder:'工區A',name:'高相似度.jpg',dataUrl:tinyImage},b:{folder:'B',name:'照片01.jpg',dataUrl:tinyImage},analysis:'高分組說明'}
 ];
 const blob=await sandbox.ImageAuditDocx.build({pairs,photoCount:4,totalPairs:4,threshold:70,engine:'測試'});
 assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 const files=await readZip(blob);
 for(const key of ['[Content_Types].xml','_rels/.rels','word/document.xml','word/_rels/document.xml.rels'])assert.ok(files[key],key+' missing');
 const media=Object.keys(files).filter(x=>x.startsWith('word/media/'));
 assert.equal(media.length,4,'Every pair needs exactly two comparison photos');
 const xml=new TextDecoder().decode(files['word/document.xml']);
 assert.ok(xml.indexOf('96.5%')<xml.indexOf('71.1%'),'Pairs must be ordered high to low');
 assert.ok(xml.includes('高分組說明')&&xml.includes('低分組說明'),'Every pair needs its explanation');
 assert.equal((xml.match(/<wp:extent cx="2520000" cy="1680000"/g)||[]).length,4,'Every photo needs the same bounded frame');
 assert.ok(xml.includes('工區A')&&xml.includes('高相似度.jpg'),'Photo source names missing');
 const rel=new TextDecoder().decode(files['word/_rels/document.xml.rels']);
 assert.equal((rel.match(/relationships\/image/g)||[]).length,4,'Missing photo relationships');
 for(const kind of ['online/index.html','offline/工程照片交叉稽核系統.html']){
   const html=fs.readFileSync(path.join(root,kind),'utf8');
   assert.ok(html.includes('ImageAuditDocx.save'),kind+' not using real DOCX');
   assert.ok(html.includes('function notify(title,detail)'),kind+' missing centered modal');
 }
 const react=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
 assert.ok(react.includes('ImageAuditDocx')&&react.includes('setDialog')&&react.includes('role="alertdialog"'),'Desktop DOCX or centered modal not integrated');
const selector=fs.readFileSync(path.join(root,'selector.html'),'utf8');
assert.ok(selector.includes('id="desktop-guide"')&&selector.includes('啟動工程照片稽核.exe')&&selector.includes('index.html'),'Desktop installation instructions must be on the download page');
 console.log('DOCX ZIP structure, pair order, uniform photo frames, descriptions and both app integrations: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
