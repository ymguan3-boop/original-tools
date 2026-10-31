/* Regression: browser and Windows must sample decoded ORIGINAL bytes, never display JPEG thumbs.
 * Synthetic images only; this is not an engineering photo accuracy dataset.
 */
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
async function verify(page){
 const src=fs.readFileSync(path.join(root,page),'utf8');
 const start=src.indexOf('async function feature(f){'),end=src.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,page+' missing canonical original-file feature()');
 const js=src.slice(start,end+2);
 const calls=[];
 const image={name:'original engineering photo',pixels:'original',close(){calls.push('closed-original')}};
 const file={name:'source.png'};
 const sandbox={
  createImageBitmap:async f=>{assert.equal(f,file);calls.push('decode-original');return image},
  sample:(img,crop)=>{calls.push('sample-'+(crop?'center':'full'));assert.equal(img,image,'scored lossy JPEG thumbnail instead of original');return {id:crop?'center':'full'}},
  imgData:async f=>{assert.equal(f,file);calls.push('encode-thumb');return {url:'blob:compressed-thumbnail',img:{pixels:'lossy-JPEG'}}}
 };
 const feature=vm.runInNewContext(js+';feature',sandbox);
 const got=await feature(file);
 assert.equal(got.full.id,'full');assert.equal(got.center.id,'center');
 assert.equal(got.thumb,'blob:compressed-thumbnail');
 assert.equal(calls.join('|'),'decode-original|sample-full|sample-center|closed-original|encode-thumb','Thumb generated before raw scoring');
 assert.ok(!src.includes('full:sample(img),center:sample(img,true)'),'Old lossy scoring still in page');
 assert.ok(src.includes('v2.3.0'),'Build and version must be traceable');
}
(async()=>{
 await verify('online/index.html');
 await verify('offline/工程照片交叉稽核系統.html');
 const desktop=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
 assert.ok(desktop.includes('createImageBitmap(files[i])'),'desktop not scoring original');
 assert.ok(desktop.includes('common.sample(bitmap)'), 'desktop not using shared core');
 assert.ok(desktop.includes('ADVANCED_BATCH_LIMIT = 20'),'missing bounded auto forensic analysis');
 assert.ok(desktop.includes('進階批次查核'),'advanced batch action not available');
 assert.ok(desktop.includes('advanced=await checkAdvanced(item)'),'export has not triggered actual local forensic analysis');
 assert.ok(desktop.includes('FAST / BRIEF'), 'export report lacks model-independent geometry explanation');
 const selector=fs.readFileSync(path.join(root,'selector.html'),'utf8');
 assert.ok(selector.includes('下載桌面版 v2.3.0'),'download version stale');
 assert.ok(selector.includes('匯出 DOCX'),'download instructions do not mention auto verification');
 assert.ok(selector.includes('FAST／BRIEF'),'missing advanced recognition description');
 const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
 assert.equal(packageJson.version,'2.3.0');assert.equal(lock.version,packageJson.version);
 assert.equal(lock.packages[''].version,packageJson.version);
 console.log('PASS: original source scoring parity, thumbnail independence, desktop forensic export and v2.3 install guide');
})().catch(e=>{console.error(e);process.exitCode=1});
