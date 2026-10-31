const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const shared=fs.readFileSync(path.join(root,'shared/report-standard.js'),'utf8');
const publicFile=fs.readFileSync(path.join(root,'public/report-standard.js'),'utf8');
assert.equal(shared,publicFile,'Windows and online must use the exact same reporting module');
const scope={};scope.window=scope;
vm.runInNewContext(shared,scope);
const api=scope.ImageAuditReportStandard;
assert.ok(api&&api.VERSION,'Missing reporting module');
const ctx={score:87.4,hash:90.5,structure:89.4,edges:78.7,registered:91.2,
 pix:92.95,col:93.7,visual:{strongEvidence:true},dino:87.4,model:'test/vision-model'};
const fence=String.fromCharCode(96).repeat(3);
const response=fence+'json\n'+JSON.stringify({similarities:['兩圖都可見同一形狀的尿斗與鄰近管線。'],differences:['B 圖略有裁切，邊框不同。'],assessment:'畫面高度接近，但無法確認原始拍攝時間。',checks:['查看施工照片原始檔。']})+'\n'+fence;
const ai=api.formatAI(response,ctx),rule=api.formatRule(ctx);
const sections=['【一、照片可見相同點】','【二、照片可見差異】','【三、客觀比對證據】','【四、查核研判】','【五、待查證事項】','【六、來源與判讀限制】'];
for(const output of [ai,rule]){
 let last=-1;for(const part of sections){const pos=output.indexOf(part);assert.ok(pos>last,'Invalid report section '+part);last=pos}
 assert.ok(output.includes('共同視覺相似度：87.4%'),'Measured evidence absent');
 assert.ok(output.includes('不等於同一來源或違規機率'),'Required safety caveat absent');
 assert.ok(output.includes('核對施工位置'),'Mandatory verification missing');
 assert.ok(!output.includes('已確定違規'),'Unsafe legal conclusion');
}
assert.ok(ai.includes('OpenRouter 視覺模型')&&ai.includes('test/vision-model'));
assert.ok(ai.includes('兩圖都可見同一形狀'),'AI observation missing');
assert.ok(rule.includes('規則模式未使用視覺語言模型'),'Rules-only report must not imply image understanding');
assert.ok(!rule.includes('OpenRouter 視覺模型'),'Rules-only report must not imply cloud AI');
assert.throws(()=>api.formatAI('答案：兩張照片完全一樣',ctx),/JSON/);
assert.throws(()=>api.formatAI(JSON.stringify({similarities:[],differences:[],assessment:'沒問題',checks:[]}),ctx),/未提供/);
assert.ok(api.prompt().includes('禁止虛構相似度分數'),'Prompt must prohibit forged metrics');
const data={choices:[{message:{content:[{type:'text',text:'{"similarities":["一致"],"differences":[],"assessment":"無法確認","checks":[]}'}]}}]};
assert.equal(api.extractContent(data).includes('similarities'),true,'Content parts not handled');
for(const name of ['online/index.html','offline/工程照片交叉稽核系統.html']){
 const html=fs.readFileSync(path.join(root,name),'utf8');
 assert.ok(html.includes('<script src="./report-standard.js"></script>'),name+' missing shared module');
 assert.ok(html.includes('report.formatAI(')&&html.includes('report.formatRule('),name+' not using common formatting');
 assert.ok(html.includes('reportText(m)'),'Report export not using common text');
}
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
assert.ok(app.includes('reportAPI().formatAI(')&&app.includes('reportAPI().formatRule('),'Desktop not using common formatting');
assert.ok(app.includes("r.analysisSource !== 'ai'"),'Rule output must be eligible for OpenRouter upgrades');
const launch=fs.readFileSync(path.join(root,'desktop/launcher.go'),'utf8');
assert.ok(launch.includes('"/report-standard.js"'),'Local server cannot serve report module');
console.log('PASS: six-section reports, trusted metrics, model provenance, malformed-response fallback and all app integrations');
