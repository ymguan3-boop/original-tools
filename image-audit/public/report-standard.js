/* Engineering photo audit: shared and validated report format v1.0. */
(function(root){
'use strict';
const VERSION='1.0';
const DEFAULT_CHECKS=['核對 A、B 原始影像、EXIF、檔案雜湊及拍攝日期／時間。','核對施工位置、工項、工程日誌、估驗計價、契約與驗收紀錄。','如有跨批次照片重用疑點，確認是否為同一拍攝來源及是否具有合理使用原因。'];
const text=(x,max=260)=>String(x==null?'':x).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/<[^>]*>/g,'').trim().slice(0,max);
const number=x=>x!==null&&x!==undefined&&Number.isFinite(Number(x))?Math.max(0,Math.min(100,Number(x))).toFixed(1)+'%':'未取得';
const safeAI=(raw,max=190)=>{
 let v=text(raw,max);
 // Visual models are not authoritative sources for numeric metrics or legal findings.
 if(/(?:pHash|dHash|DINOv2|SSIM|\d+(?:\.\d+)?\s*%)/i.test(v))
   v=v.replace(/\d+(?:\.\d+)?\s*%/g,'〔AI 數值未採用〕').replace(/(?:pHash|dHash|DINOv2|SSIM)/gi,'〔指標以系統數值為準〕');
 if(/(?:確定|證實|已經|必然|絕對|肯定|已確認).{0,12}(?:違規|違法|重複請款|詐欺|造假|不同照片|同一張照片)/.test(v))
   return 'AI 回答含尚未核實的確定性判斷，已排除；需人工查證原始檔案及工程紀錄。';
 return v;
};
const array=(v,max=3)=>(Array.isArray(v)?v:[]).filter(x=>typeof x==='string').map(x=>safeAI(x)).filter(Boolean).slice(0,max);
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
 const obs={same:array(data.similarities),different:array(data.differences),assessment:safeAI(data.assessment,260),checks:array(data.checks)};
 if(!obs.same.length&&!obs.different.length)throw Error('AI 未提供可核對的照片觀察');
 return obs;
}
function evidence(c){
 const v=c.visual||{},a=c.advanced;
 const out=[
  '【共同快速影像比對】',
  '1. 共同視覺初篩分數：'+number(c.score)+'（跨版本一致的候選排序分數，非同一影像來源機率）。',
  '2. pHash（頻率構圖）：'+number(c.hash??v.hash)+'；dHash（亮暗變化）：'+number(c.dhash??v.dhash)+'。',
  '3. 明暗結構：'+number(c.structure??v.structure)+'；邊緣一致性：'+number(c.edges??v.edges)+'；位置校正：'+number(c.registered??v.registered)+'。',
  '4. 像素：'+number(c.pix??v.pix)+'；色彩：'+number(c.col??v.col)+'，僅用作輔助查核。',
  '5. 白邊處理與多區域取樣：'+(v.borderTrimmed?'偵測並排除外側近白邊，與全圖及中心裁切共同比對':'使用原圖及多區域裁切特徵')+'；最佳區域：'+text(v.area||'全圖',45)+'。'
 ];
 if(c.edition==='desktop'||a){
  out.push('【桌面版全配對辨識：按「開始分析」自動執行】');
  out.push('6. DINOv2-small 全圖語意特徵：'+number(c.dino)+'，辨識場景內容是否接近；不改動共同分數。');
  out.push('7. DINOv2 局部 Patch：'+(c.patchSimilarity==null?'目前模型無可用局部特徵輸出':number(c.patchSimilarity))+'，輔助觀察區域特徵。');
  if(a?.status==='byte-identical'){
   out.push('8. SHA-256：已確認檔案位元組完全相同；不必以局部特徵再證明位元組相同。');
  }else if(a){
   out.push('8. 局部特徵方法：'+text(a.method||'FAST / BRIEF',80)+'；雙圖匹配 '+a.matches+' 點'+(a.siftMatches!=null?'（SIFT-style 候選 '+a.siftMatches+' 點）':'')+'。');
   out.push('9. RANSAC 幾何一致性（縮放、旋轉、位移）：'+a.inliers+' 個內點、內點比例 '+number(a.inlierRatio)+'、特徵分布範圍 '+number(a.coverage)+'。');
   out.push('10. 對齊後 SSIM：'+number(a.alignedSSIM)+'；有效重疊面積比例：'+number(a.overlap)+'；差異像素比例：'+number(a.differenceArea)+'。');
   out.push('11. 影像同源判讀：'+text(a.label,140)+'。'+text(a.note,220));
  }else out.push('8–11. 本組局部辨識尚未取得結果，須重新分析，不能以未取得結果推定不同照片。');
  if(c.geometryRescued===true)out.push('【補列原因】本組共同分數低於設定門檻，但局部幾何證據支持疑似同源，因此仍列入查核清單。');
 }
 out.push('【解讀限制】這些均為影像特徵指標；不等於同一拍攝來源、違規或重複請款的機率。');
 return out.join('\n');
}
function triage(c){
 const a=c.advanced;
 if(c.identical===true||a?.status==='byte-identical')return 'SHA-256 確認檔案完全相同，應優先查證跨批次引用及施工佐證，但不得直接推定重複計價。';
 if(a?.status==='verified')return (a.method||'FAST／BRIEF')+' 與 RANSAC 的幾何對應，加上有效重疊區域 SSIM，共同支持高度疑似同一來源。快速分數可能因白邊或裁切偏低，仍須核對原始照片、拍攝時間與工程紀錄。';
 if(a?.status==='review')return '部分局部特徵具幾何對應，但目前證據不能確認同源；列為人工複核，亦不得認定必然不同。';
 if(c.strongEvidence===true||c.visual?.strongEvidence===true)return '多項快速視覺證據一致，建議優先核對原始照片；局部幾何結果可能不足或未取得。';
 const value=Number(c.score);
 if(Number.isFinite(value)&&value>=75)return '照片有可比對的視覺相似處，應人工複核；無法只憑分數確認是否同源。';
 return '現有證據不足以確認同源或排除同源；若局部幾何驗證失敗，應排除技術問題後重試。';
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
