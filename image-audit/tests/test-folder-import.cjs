const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'shared/multi-folder-import.js'),'utf8');
assert.equal(fs.readFileSync(path.join(root,'public/multi-folder-import.js'),'utf8'),source,'Web and desktop must use same batch importer');
const photo=name=>({name,type:'image/jpeg'});
const dir=(name,entries)=>({kind:'directory',name,async *values(){for(const x of entries)yield x}});
const item=(name)=>({kind:'file',name,async getFile(){return photo(name)}});
function node(tag){
 return {tag,style:{cssText:''},children:[],listeners:{},disabled:false,hidden:false,
   append(...xs){this.children.push(...xs);for(const x of xs)x.parent=this},
   appendChild(x){this.append(x)},
   removeChild(x){this.children.splice(this.children.indexOf(x),1)},
   replaceChildren(...xs){this.children=xs},
   setAttribute(k,v){this[k]=v},
   addEventListener(k,f){this.listeners[k]=f},
   focus(){},
   remove(){this.removed=true},
   click(){this.onclick?.()},
   set textContent(value){this._text=value},
   get textContent(){return this._text}
 };
}
const document={body:node('body'),createElement:node,activeElement:{focus(){}}};
const picks=[];
const world={document,console,setTimeout,showDirectoryPicker:async()=>{if(!picks.length)throw Error('No staged directory');return picks.shift()}};
world.window=world;
vm.runInNewContext(source,world);
const api=world.ImageAuditFolderPicker;
assert.equal(api.version,'1.0');
const folders=[dir('第一批次',[item('A.jpg')]),dir('第二批次',[item('B.png')])];
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
(async()=>{
 const added=[];
 picks.push(...folders);
 const picker=api.open({onComplete:groups=>added.push(groups)});
 let card=document.body.children.at(-1).children[0],buttons=card.children[2],foot=card.children[6];
 buttons.children[0].onclick();await flush();await flush();
 assert.equal(picker.stagedCount,1,'first folder must remain staged');
 buttons.children[0].onclick();await flush();await flush();
 assert.equal(picker.stagedCount,2,'second independent folder must accumulate');
 foot.children[1].onclick();
 assert.equal(added.length,1,'must commit exactly once');
 assert.equal(added[0].map(g=>g.name).join('|'),'第一批次|第二批次');
 assert.equal(added[0][0].files[0].name,'A.jpg');
 assert.equal(added[0][1].files[0].name,'B.png');

 const parent=dir('工程照片',[dir('第一次',[item('1.jpg')]),dir('第二次',[item('2.jpg')]),item('root.jpg')]);
 picks.push(parent);
 const groupPicker=api.open({onComplete:groups=>added.push(groups)});
 card=document.body.children.at(-1).children[0];buttons=card.children[2];foot=card.children[6];
 buttons.children[1].onclick();await flush();await flush();
 assert.equal(groupPicker.stagedCount,3,'parent must split sibling folders plus root');
 foot.children[1].onclick();
 assert.equal(added[1].map(g=>g.name).join('|'),'工程照片（根目錄）|第一次|第二次');

 const d1=dir('外部一',[item('x.jpg')]),d2=dir('外部二',[item('y.jpg')]);
 const dropped=await api.droppedGroups([
  {getAsFileSystemHandle:()=>Promise.resolve(d1)},
  {getAsFileSystemHandle:()=>Promise.resolve(d2)}
 ],f=>f.name.endsWith('.jpg'));
 assert.equal(dropped.map(g=>g.name).join('|'),'外部一|外部二');
 assert.equal(dropped.reduce((n,g)=>n+g.files.length,0),2);

 const relative=api.fromRelative([
  {...photo('1.jpg'),webkitRelativePath:'工程/第1期/1.jpg'},
  {...photo('2.jpg'),webkitRelativePath:'工程/第2期/2.jpg'}
 ],true);
 assert.equal(relative.map(g=>g.name).join('|'),'第1期|第2期');

 for(const p of ['online/index.html','offline/工程照片交叉稽核系統.html']){
  const s=fs.readFileSync(path.join(root,p),'utf8');
  assert.ok(s.includes('<script src="./multi-folder-import.js"></script>'),p+' script missing');
  assert.ok(s.includes('ImageAuditFolderPicker'),p+' new picker not wired');
  assert.ok(s.includes('onComplete:groups=>addGroupedPhotos'),p+' multi-folder completion not wired');
  assert.ok(!s.includes("manyFolderInput"),p+' old single-directory pretending to be multi-picker');
 }
 const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
 assert.ok(app.includes('ImageAuditFolderPicker'),'desktop new picker not connected');
 assert.ok(app.includes('onComplete:appendGroups'),'desktop staged groups not committed');
 assert.ok(!app.includes('desktopManyFolderInput'),'desktop fake multi-picker not removed');
 const launcher=fs.readFileSync(path.join(root,'desktop/launcher.go'),'utf8');
 assert.ok(launcher.includes('"/multi-folder-import.js"'),'Windows localhost must serve picker JS');
 console.log('PASS: repeated independent folders, parent grouping, multiple dragged folders, web/desktop integration');
})().catch(e=>{console.error(e);process.exitCode=1});
