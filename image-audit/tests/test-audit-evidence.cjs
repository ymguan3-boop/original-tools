const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const input=fs.readFileSync(path.join(root,'src/auditEvidence.ts'),'utf8');
const compiled=ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={exports:{}};vm.runInNewContext(compiled,{exports:mod.exports,module:mod});
const {assessPhotoEvidence,buildAuditRule}=mod.exports;
const examples=[
 {dino:87.4,pixel:92.95,level:'high',source:'user report group 6'},
 {dino:87.3,pixel:93.91,level:'high',source:'user report group 7'},
 {dino:88.4,pixel:91.06,level:'high',source:'user report group 4'},
 {dino:95.5,pixel:88.61,level:'high',source:'user report group 1'},
 {dino:87.8,pixel:60.51,level:'review',source:'cropped photo from user report group 5'},
 {dino:83.1,pixel:90.91,level:'review',source:'user report group 8'},
 {dino:null,pixel:91.5,level:'review',source:'pixel-only evidence'},
 {dino:42,pixel:37,level:'undetermined',source:'unrelated low scores'}
];
for(const row of examples){
 const got=assessPhotoEvidence(row);
 assert.equal(got.level,row.level,row.source+' level');
 const text=buildAuditRule(row);
 assert.ok(text.includes('建議查證'),'Missing verification section');
 assert.ok(!/研判為不同照片|無重複請款疑慮|應為不同影像|低風險/.test(text),'Unsound clearance in '+row.source);
}
for(const file of ['online/index.html','offline/工程照片交叉稽核系統.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 assert.ok(html.includes('comparator-core.js'),file+': shared comparator script missing');
 assert.ok(html.includes('showDirectoryPicker'),file+': no secure picker');
 assert.ok(html.includes('選取多張照片'),file+': no multi-file alternative');
 assert.ok(html.includes('const {sample,compare,rule}=window.ImageAuditComparator'),file+': no shared rule');
}
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
assert.ok(app.includes('reportAPI().formatRule('),'Standardized local audit evidence is not integrated');
assert.ok(app.includes('const visual=common.compare(va,vb)'),'Shared visual screening no longer integrated');
assert.ok(app.includes('chooseManyDirectories'),'Desktop multi-folder import absent');
assert.ok(app.includes('addSelectedFiles')&&app.includes('chooseDirectory'),'Desktop safer import absent');
console.log('PASS: 8 audit evidence cases, 2 browser scoring/rule engines and safe import paths');
