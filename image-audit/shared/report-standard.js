/* Engineering photo audit: shared and validated report format v1.0. */
(function(root){
'use strict';
const VERSION='1.0';
const DEFAULT_CHECKS=['核對 A、B 原始影像、EXIF、檔案雜湊及拍攝日期／時間。','核對施工位置、工項、工程日誌、估驗計價、契約與驗收紀錄。','如有跨批次照片重用疑點，確認是否為同一拍攝來源及是否具有合理使用原因。'];
const text=(x,max=260)=>String(x==null?'':x).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/<[^>]*>/g,'').trim().slice(0,max);
const number=x=>x!==null&&x!==undefined&&Number.isFinite(Number(x))?Math.max(0,Math.min(100,Number(x))).toFixed(1)+'%':'未取得';
const array=(v,max=3)=>(Array.isArray(v)?v:[]).filter(x=>typeof x==='string').map(x=>text(x,190)).filter(Boolean).slice(0,max);
function prompt(){
 return [
 '你是工程照片雙圖的中立觀察員，僅能描述提供的 A、B 兩張影像中可看見的內容。',
 '只輸出一個 JSON 物件，不要 Markdown、不要程式碼框、不要額外字詞。',
 'JSON 必須包含四個欄位：',
 '{"similarities":["實際可見相同點1","實際可見相同點2"],"differences":["實際可見差異1"],"assessment":"影像同源的觀察推論，若無法確認須明確寫無法確認","checks":["根據照片可提出的核查事項1"]}',
 'similarities、differences、checks 應為最多3個簡短繁體中文句子的陣列；不能確定時使用空陣列。',
 '只描述有影像根據的場景、物體、位置、結構與變化；不猜測拍攝日期、工地、工程數量、影像加工方式或 EXIF。',
 '禁止虛構相似度分數、特徵點數、SSIM 或比對演算法結果。',
 '禁止斷言違法、重複請款、詐欺、工程已完工、照片一定不同或必然為同一來源。',
 '不得將照片看起來相似直接視為施工或計價異常；所有判讀仍待人工查證。',
 '兩圖有差異時具體指出所在位置；不可把無法確定的內容寫成事實。'
 ].join('\n');
}
function extractContent(data){
 const content=data?.choices?.[0]?.message?.content;
 if(typeof content==='string')return content;
 if(Array.isArray(content))return content.filter(x=>x&&x.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n');
 return '';
}
function parseAI(raw){
 const s=String(raw||'').trim().replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'').trim();
 if(s.length>15000)throw Error('AI 輸出過長');
 const a=s.indexOf('{'),b=s.lastIndexOf('}');
 if(a<0||b<=a)throw Error('AI 未回傳結構化 JSON');
 let data;
 try{data=JSON.parse(s.slice(a,b+1));}catch{throw Error('AI JSON 無法解析');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('AI 格式不符合報告欄位');
 if(!Array.isArray(data.similarities)||!Array.isArray(data.differences)||!Array.isArray(data.checks)||typeof data.assessment!=='string')throw Error('AI 缺少必要欄位');
 const obs={same:array(data.similarities),different:array(data.differences),assessment:text(data.assessment,260),checks:array(data.checks)};
 if(!obs.same.length&&!obs.different.length)throw Error('AI 未提供可核對的照片觀察');
 return obs;
}
function evidence(c){
 const visual=c.visual||{},result=['共同視覺相似度：'+number(c.score)];
 const names=[['pHash',c.hash??visual.hash],['dHash',c.dhash??visual.dhash],['明暗結構',c.structure??visual.structure],['邊緣一致性',c.edges??visual.edges],['位置校正',c.registered??visual.registered],['像素',c.pix??visual.pix],['色彩',c.col??visual.col]];
 for(const [name,val] of names)if(val!=null)result.push(name+'：'+number(val));
 if(c.dino!=null)result.push('DINOv2（輔助）：'+number(c.dino));
 if(c.patchSimilarity!=null)result.push('DINOv2 局部 Patch（輔助）：'+number(c.patchSimilarity));
 return result.join('；')+'。各項為視覺指標，非同源或違規機率；DINOv2 不參與共同門檻。';
}
function triage(c){
 if(c.identical===true)return '檔案雜湊相同，應核對是否跨批次使用相同來源；不直接推定違規。';
 if(c.strongEvidence===true||c.visual?.strongEvidence===true)return '多項視覺證據一致，列為高度疑似影像同源，建議優先核對原始照片。';
 const v=Number(c.score);
 if(Number.isFinite(v)&&v>=75)return '照片具有可比對的視覺相似處，列為人工複核線索；尚不能確認是否同源。';
 return '現有指標不足以確定影像是否同源；不得因此認定照片必然不同或排除工程異常。';
}
function lines(title,arr,empty){return '【'+title+'】\n'+(arr.length?arr.map((s,i)=>(i+1)+'. '+s).join('\n'):'（'+empty+'）');}
function format(options){
 const c=options||{},isAI=c.source==='ai'&&!!c.ai;
 const observations=isAI?c.ai:{same:[],different:[],checks:[],assessment:''};
 const checks=[...observations.checks,...DEFAULT_CHECKS].filter((s,i,a)=>a.indexOf(s)===i).slice(0,6);
 const source=isAI?'OpenRouter 視覺模型':'本機規則模板';
 const model=isAI?'；模型：'+text(c.model||'未回傳',150):'';
 const when=text(c.generatedAt||new Date().toLocaleString('zh-TW'),70);
 const note=c.reason?'；備註：'+text(c.reason,140):'';
 return [
  lines('一、照片可見相同點',observations.same,isAI?'AI 未能辨識明確共同點':'規則模式未使用視覺語言模型，請人工觀察'),
  lines('二、照片可見差異',observations.different,isAI?'AI 未能辨識明確差異，不代表不存在':'規則模式未使用視覺語言模型，請人工觀察'),
  '【三、客觀比對證據】\n'+evidence(c),
  '【四、查核研判】\n系統判讀：'+triage(c)+(isAI?'\nAI 觀察推論（僅供複核）：'+(observations.assessment||'未提供'):'\n本組僅提供規則推論，未使用雲端 AI 雙圖觀察。'),
  lines('五、待查證事項',checks,'請人工核對工程資料'),
  '【六、來源與判讀限制】\n產生方式：'+source+model+'；產製時間：'+when+note+'。\n影像相似度不等於同一來源或違規機率；不得只憑本報告認定重複請款或工程違失。'
 ].join('\n\n');
}
function formatAI(raw,options){return format({...options,source:'ai',ai:parseAI(raw)});}
function formatRule(options){return format({...options,source:'rule',ai:null});}
root.ImageAuditReportStandard={VERSION,prompt,parseAI,extractContent,format,formatAI,formatRule,evidence,triage};
})(typeof window!=='undefined'?window:globalThis);
