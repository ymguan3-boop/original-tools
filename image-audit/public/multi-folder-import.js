/* Browser multi-directory batch importer v1.0
 * Native pickers select ONE directory per invocation. This dialog stages many
 * independently chosen folders, or imports sibling folders from one parent.
 * Supports dragging multiple top-level folders where browser DnD permits.
 * Nothing is uploaded. Browser security permission prompts cannot be bypassed.
 */
(function(root){
'use strict';
const isAbort=e=>e&&(e.name==='AbortError'||e.code===20);
const nativePicker=()=>typeof root.showDirectoryPicker==='function';
const isImage=(file)=>/^image\/(jpeg|png|webp|bmp|gif)$/i.test(file.type)||/\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name);
function fromRelative(files,parent){
 const groups=new Map(),list=Array.from(files||[]);
 for(const f of list){
  if(!isImage(f))continue;
  const parts=String(f.webkitRelativePath||f.name).split('/').filter(Boolean);
  const group=parent?(parts.length>=3?parts[1]:parts[0]+'（根目錄）'):(parts[0]||'照片資料夾');
  if(!groups.has(group))groups.set(group,[]);
  groups.get(group).push(f);
 }
 return [...groups].map(([name,files])=>({name,files}));
}
async function readDirectory(handle,accept){
 const output=[];
 async function walk(directory){
  for await(const child of directory.values()){
   if(child.kind==='file'){const f=await child.getFile();if(accept(f))output.push(f)}
   else if(child.kind==='directory')await walk(child);
  }
 }
 await walk(handle);return output;
}
async function fromParent(handle,accept){
 const groups=[],rootFiles=[];
 for await(const child of handle.values()){
  if(child.kind==='directory'){
   const files=await readDirectory(child,accept);
   if(files.length)groups.push({name:child.name,files});
  }else if(child.kind==='file'){
   const f=await child.getFile();if(accept(f))rootFiles.push(f);
  }
 }
 if(rootFiles.length)groups.unshift({name:handle.name+'（根目錄）',files:rootFiles});
 return groups;
}
function entryAsFile(entry){
 return new Promise((resolve,reject)=>entry.file(resolve,reject));
}
async function legacyEntryFiles(entry,accept){
 if(entry.isFile){const f=await entryAsFile(entry);return accept(f)?[f]:[]}
 if(!entry.isDirectory)return [];
 const reader=entry.createReader(),files=[];
 while(true){
  const chunk=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
  if(!chunk.length)break;
  for(const child of chunk)files.push(...await legacyEntryFiles(child,accept));
 }
 return files;
}
async function droppedGroups(items,accept){
 const inputs=Array.from(items||[]),groups=[];
 // getAsFileSystemHandle must be called inside the user drop gesture.
 const handlePromises=inputs.map(item=>item.getAsFileSystemHandle?item.getAsFileSystemHandle():null);
 for(let i=0;i<inputs.length;i++){
  const item=inputs[i];let handle=handlePromises[i]?await handlePromises[i]:null;
  if(handle){
   if(handle.kind==='directory'){
    const files=await readDirectory(handle,accept);
    if(files.length)groups.push({name:handle.name,files});
   }else if(handle.kind==='file'){
    const f=await handle.getFile();
    if(accept(f))groups.push({name:'散落照片',files:[f]});
   }
   continue;
  }
  const entry=typeof item.webkitGetAsEntry==='function'?item.webkitGetAsEntry():null;
  if(entry){
   const files=await legacyEntryFiles(entry,accept);
   if(files.length)groups.push({name:entry.isDirectory?entry.name:'散落照片',files});
  }else if(typeof item.getAsFile==='function'){
   const f=item.getAsFile();
   if(f&&accept(f))groups.push({name:'散落照片',files:[f]});
  }
 }
 // Drop images without folder wrappers as one single group.
 const loose=groups.filter(g=>g.name==='散落照片');
 return [...groups.filter(g=>g.name!=='散落照片'),...(loose.length?[{name:'散落照片',files:loose.flatMap(g=>g.files)}]:[])];
}
function open(options){
 if(!root.document)throw Error('需要瀏覽器文件環境');
 const doc=root.document,accept=options.isPhoto||isImage;
 const staged=[];
 let working=false,closed=false;
 const overlay=doc.createElement('div');
 overlay.id='image-audit-multi-folder-dialog';
 overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
 overlay.setAttribute('aria-label','批次加入多個資料夾');
 overlay.style.cssText='position:fixed;inset:0;background:rgba(18,35,58,.63);z-index:120000;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(5px)';
 const card=doc.createElement('div');
 card.style.cssText='background:#fff;color:#1a3355;width:min(600px,96vw);max-height:92vh;overflow:auto;padding:24px;border-radius:18px;box-shadow:0 18px 70px rgba(0,0,0,.22);font-family:system-ui,Microsoft JhengHei,sans-serif';
 const h=doc.createElement('h2');h.textContent='加入多個資料夾';h.style.cssText='margin:0 0 12px;font-size:21px;color:#183b67';
 const help=doc.createElement('p');help.style.cssText='font-size:14px;color:#516581;line-height:1.7;margin:0 0 13px';
 help.textContent='每按一次「選取下一個資料夾」，選取一個來源；可重複加入不同磁碟位置的資料夾。全部選好後點「完成加入」。亦可拖入多個資料夾，或選共同父資料夾自動分組。';
 const controls=doc.createElement('div');controls.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px';
 const makeButton=(title,outline=false)=>{
  const b=doc.createElement('button');b.type='button';b.textContent=title;
  b.style.cssText='font:inherit;font-size:14px;font-weight:650;cursor:pointer;padding:10px 13px;border-radius:9px;border:1px solid #8db1d7;color:'+(outline?'#1f5b94':'#fff')+';background:'+(outline?'#fff':'#2369ab');
  controls.append(b);return b;
 };
 const pick=makeButton('＋ 選取下一個資料夾');
 const parent=makeButton('＋ 父資料夾自動分組',true);
 const drop=doc.createElement('div');drop.tabIndex=0;drop.setAttribute('aria-label','拖入多個資料夾區');
 drop.textContent='也可以將多個資料夾從檔案總管一起拖到這裡';
 drop.style.cssText='border:2px dashed #9bbcdf;background:#f5faff;border-radius:12px;text-align:center;padding:16px;color:#426589;font-size:13px;line-height:1.7;min-height:50px;margin-bottom:10px';
 const status=doc.createElement('div');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 status.style.cssText='font-size:13px;color:#2e5e8d;min-height:23px;margin-bottom:7px';
 const list=doc.createElement('div');list.style.cssText='max-height:220px;overflow:auto;border:1px solid #e2e9f1;border-radius:9px;padding:8px;background:#fafcff;font-size:13px';
 const foot=doc.createElement('div');foot.style.cssText='display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:15px';
 const closeButton=makeButton('取消',true),finish=makeButton('完成加入');
 controls.removeChild(closeButton);controls.removeChild(finish);
 foot.append(closeButton,finish);
 const warning=doc.createElement('p');warning.style.cssText='font-size:12px;color:#8a6470;line-height:1.6;margin:12px 0 0';
 warning.textContent='瀏覽器原生選取器無法一次多選不相鄰的資料夾，所以本功能採連續挑選後一次加入；安全授權提示仍由瀏覽器管理。所有照片只在本機讀取，未經同意不會上傳。';
 const input=doc.createElement('input');input.type='file';input.multiple=true;input.setAttribute('webkitdirectory','');input.setAttribute('directory','');input.hidden=true;
 card.append(h,help,controls,drop,status,list,foot,warning,input);overlay.append(card);doc.body.append(overlay);
 let previousFocus=doc.activeElement;pick.focus();
 const setStatus=s=>{status.textContent=s};
 const paint=()=>{
  list.replaceChildren();
  if(!staged.length){const e=doc.createElement('p');e.textContent='尚未選取資料夾。';e.style.cssText='margin:6px;color:#70839a';list.append(e)}
  staged.forEach((g,i)=>{
   const line=doc.createElement('div');line.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:7px 5px;gap:8px;border-bottom:1px solid #e9eef5';
   const name=doc.createElement('span');name.textContent=(i+1)+'. '+g.name+'（'+g.files.length+' 張）';name.style.cssText='word-break:break-all';
   const remove=doc.createElement('button');remove.type='button';remove.textContent='移除';remove.style.cssText='color:#a32f43;cursor:pointer;border:0;background:none;padding:5px';
   remove.onclick=()=>{if(working)return;staged.splice(i,1);paint()};
   line.append(name,remove);list.append(line);
  });
  const total=staged.reduce((n,g)=>n+g.files.length,0);
  setStatus('待加入：'+staged.length+' 個資料夾、'+total+' 張照片');
  finish.disabled=!staged.length||working;
 };
 function stage(groups){
  for(const g of groups||[]){
   const files=Array.from(g.files||[]).filter(accept);
   if(files.length)staged.push({name:g.name||'照片資料夾',files});
  }
  paint();
 }
 function busy(on){
  working=on;pick.disabled=on;parent.disabled=on;finish.disabled=on||!staged.length;closeButton.disabled=on;
  if(on)setStatus('正在讀取選定的資料夾…');
 }
 function teardown(){
  closed=true;overlay.remove();
  if(previousFocus&&typeof previousFocus.focus==='function')previousFocus.focus();
 }
 // Fallback input cannot select multiple unrelated directories in a single dialog.
 // Each input onchange adds a new stage, so users can keep picking one after another.
 let fallbackParent=false;
 input.addEventListener('change',()=>{
  const groups=fromRelative(input.files,fallbackParent);
  if(fallbackParent)stage(groups);else if(groups.length)stage([{name:groups[0].name,files:groups.flatMap(g=>g.files)}]);
  else setStatus('此資料夾沒有可用的照片');
  input.value='';
 });
 async function choose(split){
  if(working)return;
  if(!nativePicker()){fallbackParent=split;input.click();return}
  busy(true);
  try{
   const handle=await root.showDirectoryPicker({mode:'read'});
   const groups=split?await fromParent(handle,accept):[{name:handle.name,files:await readDirectory(handle,accept)}];
   if(groups.length)stage(groups);else setStatus('資料夾沒有可用照片；可繼續選取其他資料夾。');
  }catch(e){
   if(!isAbort(e))setStatus('選取失敗：'+(e.message||String(e))+'；請改以拖曳資料夾試試。');
  }finally{busy(false);paint()}
 }
 pick.onclick=()=>{void choose(false)};
 parent.onclick=()=>{void choose(true)};
 drop.addEventListener('dragover',e=>{e.preventDefault();drop.style.background='#e5f2ff'});
 drop.addEventListener('dragleave',()=>{drop.style.background='#f5faff'});
 drop.addEventListener('drop',async e=>{
  e.preventDefault();drop.style.background='#f5faff';
  if(working)return;
  busy(true);
  try{const groups=await droppedGroups(e.dataTransfer?.items,accept);
   if(groups.length)stage(groups);else setStatus('沒有發現可用的照片資料夾；可改按「選取下一個資料夾」。');
  }catch(error){setStatus('拖曳讀取失敗：'+(error?.message||String(error)))}finally{busy(false);paint()}
 });
 closeButton.onclick=()=>teardown();
 finish.onclick=()=>{
  if(!staged.length||working)return;
  const output=staged.map(g=>({name:g.name,files:g.files.slice()}));
  teardown();
  options.onComplete(output);
 };
 paint();
 return {get stagedCount(){return staged.length},close:teardown,stage};
}
root.ImageAuditFolderPicker={version:'1.0',open,fromRelative,readDirectory,fromParent,droppedGroups};
})(typeof window!=='undefined'?window:globalThis);
