/* Contract test: accurate percentage definitions and scopes across all UIs. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..');
const selector=fs.readFileSync(path.join(base,'selector.html'),'utf8');
const desktop=fs.readFileSync(path.join(base,'src/App.tsx'),'utf8');
const online=fs.readFileSync(path.join(base,'online/index.html'),'utf8');
const offline=fs.readFileSync(path.join(base,'offline/工程照片交叉稽核系統.html'),'utf8');
for(const [p,html] of [['selector',selector],['online',online],['offline',offline]]){
 assert.ok(html.includes('parameter-table')&&html.includes('<thead>')&&html.includes('RANSAC'),
  p+': missing semantic parameter table');
 assert.ok(html.includes('百分比／指標定義'),p+': percentage meaning is undocumented');
 assert.ok(html.includes('SIFT-style'),p+': SIFT-style method description is missing');
 assert.ok(html.includes('非')||html.includes('不是同源'),p+': source-probability limitation is missing');
}
assert.ok(desktop.includes('<table')&&desktop.includes('PARAMETER_GUIDE_ROWS.map'),'desktop table not rendered');
const match=desktop.match(/const PARAMETER_GUIDE_ROWS[^=]*=\s*(\[[\s\S]*?\]);/);
assert.ok(match,'desktop parameter reference data missing');
const rows=JSON.parse(match[1]);
assert.equal(rows.length,16,'expect sixteen core parameters and methods');
for(const row of rows){assert.equal(row.length,5);assert.ok(row.every(v=>typeof v==='string'&&v.trim()));}
const methods=['pHash','dHash','DINOv2','FAST','BRIEF','SIFT-style','RANSAC','SSIM','SHA-256','MobileSAM'];
for(const method of methods){
 assert.ok(desktop.includes(method)&&selector.includes(method),method+' missing from parameter guide');
}
assert.ok(desktop.includes('所有跨批次照片配對'),'desktop full-scan description missing');
assert.ok(!desktop.includes('進階驗證僅對點選的組別執行'),'obsolete on-click-only instructions must be removed');
assert.ok(!online.includes('桌面版<strong>個別照片進階查核</strong>'),'stale online instruction');
assert.ok(!offline.includes('桌面版<strong>個別照片進階查核</strong>'),'stale offline instruction');
assert.ok(selector.includes('內點比例＝')&&selector.includes('差異比例＝'),
 'Percentage definitions missing for geometric metrics');
console.log('PASS: detailed parameter and percentage tables on selector, web and desktop UI');
