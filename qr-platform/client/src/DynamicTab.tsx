import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  QrCode, Download, Copy, Check, Plus, ExternalLink,
  Repeat, RotateCcw, FileDown, Link2,
} from 'lucide-react';
import {
  ActivityMap, fixedLinkFor, testLinkFor, loadOverrides, saveOverrides,
  loadActivities, buildLinksJson, todayStr, isValidSlug, isValidHttpUrl,
} from './dynamicQr';

export default function DynamicTab() {
  const [activities, setActivities] = useState<ActivityMap | null>(null);
  const [loadError, setLoadError] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>(() => loadOverrides());
  const [selected, setSelected] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState('');

  // 載入中轉表
  useEffect(() => {
    loadActivities()
      .then((map) => {
        setActivities(map);
        const keys = Object.keys(map);
        if (keys.length > 0) setSelected(keys[0]);
      })
      .catch((e: any) => setLoadError(e?.message || '載入失敗'));
  }, []);

  const effectiveTarget = (code: string): string => {
    if (!code) return '';
    if (overrides[code]) return overrides[code];
    return activities?.[code]?.target || '';
  };

  // 切換活動時同步編輯框
  useEffect(() => {
    if (selected) setEditTarget(effectiveTarget(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, activities]);

  const fixedLink = selected ? fixedLinkFor(selected) : '';
  const modified = selected ? selected in overrides : false;
  const editValid = isValidHttpUrl(editTarget);

  const renderQR = useCallback(async () => {
    if (!fixedLink || !canvasRef.current) return;
    try {
      await QRCode.toCanvas(canvasRef.current, fixedLink, {
        width: 320, margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      const du = await QRCode.toDataURL(fixedLink, {
        width: 1024, margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      setDataUrl(du);
    } catch {
      /* 忽略 */
    }
  }, [fixedLink]);

  useEffect(() => { renderQR(); }, [renderQR]);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveLocal = () => {
    if (!selected || !editValid || !activities) return;
    const next = { ...overrides, [selected]: editTarget.trim() };
    setOverrides(next);
    saveOverrides(next);
    setActivities({
      ...activities,
      [selected]: { ...activities[selected], target: editTarget.trim(), updatedAt: todayStr() },
    });
    setMsg('已儲存為本機變更，此瀏覽器測試跳轉立即生效。要讓所有人生效，請下載 links.json 並更新到 repo。');
  };

  const handleRevert = () => {
    if (!selected) return;
    const next = { ...overrides };
    delete next[selected];
    setOverrides(next);
    saveOverrides(next);
    setMsg('已還原為已發佈版本（links.json 的內容）。');
  };

  const handleAdd = () => {
    const slug = newSlug.trim();
    if (!isValidSlug(slug)) { setMsg('代碼格式錯誤：限 2–32 字元，僅英文、數字、-、_'); return; }
    if (!newLabel.trim()) { setMsg('請填寫活動名稱'); return; }
    if (!isValidHttpUrl(newTarget)) { setMsg('新活動的目標網址格式錯誤，需以 http(s):// 開頭'); return; }
    if (activities && activities[slug]) { setMsg(`代碼 ${slug} 已存在，請換一個`); return; }
    const entry = { label: newLabel.trim(), target: newTarget.trim(), updatedAt: todayStr() };
    setActivities({ ...(activities || {}), [slug]: entry });
    const next = { ...overrides, [slug]: entry.target };
    setOverrides(next);
    saveOverrides(next);
    setSelected(slug);
    setNewSlug(''); setNewLabel(''); setNewTarget('');
    setMsg(`已新增 ${slug}（本機）。同樣要更新 links.json 並部署才會公開生效。`);
  };

  const handleDownloadJson = () => {
    if (!activities) return;
    const merged: ActivityMap = { ...activities };
    for (const [k, v] of Object.entries(overrides)) {
      if (merged[k]) merged[k] = { ...merged[k], target: v, updatedAt: todayStr() };
      else merged[k] = { label: k, target: v, updatedAt: todayStr() };
    }
    const blob = new Blob([buildLinksJson(merged)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'links.json';
    a.click();
    URL.revokeObjectURL(href);
  };

  const handleDownloadPNG = () => {
    if (!dataUrl || !selected) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `dynamic-qr-${selected}.png`;
    a.click();
  };

  const handleDownloadSVG = async () => {
    if (!fixedLink || !selected) return;
    const svg: string = await QRCode.toString(fixedLink, {
      type: 'svg', margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    } as any) as unknown as string;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `dynamic-qr-${selected}.svg`;
    a.click();
    URL.revokeObjectURL(href);
  };

  if (loadError) {
    return (
      <div className="bg-white rounded-2xl border border-red-200 p-6 text-sm text-red-700">
        中轉表載入失敗：{loadError}（請確認 client/public/links.json 存在並已部署）
      </div>
    );
  }
  if (!activities) {
    return <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">載入活動清單中…</div>;
  }

  const codes = Object.keys(activities);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6">
      {/* Left */}
      <div className="space-y-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Repeat className="w-4 h-4 text-indigo-600" /> 選擇活動 QR Code
          </label>
          <select
            value={selected}
            onChange={(e) => { setSelected(e.target.value); setMsg(''); }}
            className="mt-2 w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-white outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
          >
            {codes.map((c) => (
              <option key={c} value={c}>
                {c} — {activities[c].label}{overrides[c] ? ' ●本機已修改' : ''}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500">
            每個代碼對應一張「永不失效」的 QR 圖，掃描後會跳到下方設定的目標網址。
          </p>
        </div>

        {selected && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <QrCode className="w-4 h-4 text-indigo-600" /> 固定連結（印在 QR 裡，永不變）
            </label>
            <div className="mt-2 flex gap-2">
              <input
                readOnly
                value={fixedLink}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-xs font-mono bg-slate-50 text-slate-700 outline-none"
              />
              <button
                onClick={() => copyText(fixedLink)}
                className="px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium inline-flex items-center gap-1.5"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copied ? '已複製' : '複製'}
              </button>
            </div>
            <a
              href={testLinkFor(selected)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
            >
              開啟測試跳轉 <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {selected && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Link2 className="w-4 h-4 text-indigo-600" /> 目標網址（隨時可改，QR 圖不變）
              {modified && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">本機已修改</span>
              )}
            </label>
            <input
              value={editTarget}
              onChange={(e) => setEditTarget(e.target.value)}
              placeholder="https://example.com/最新活動頁"
              className={`mt-2 w-full px-4 py-3 rounded-xl border text-sm outline-none transition bg-white
                ${editValid || !editTarget.trim() ? 'border-slate-200 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50' : 'border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-50'}`}
            />
            {!editValid && editTarget.trim() && (
              <p className="mt-2 text-xs text-red-600">請輸入完整網址，需以 http:// 或 https:// 開頭</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleSaveLocal}
                disabled={!editValid}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                儲存變更（本機立即生效）
              </button>
              {modified && (
                <button
                  onClick={handleRevert}
                  className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> 還原已發佈版
                </button>
              )}
            </div>
            {msg && <p className="mt-2 text-xs leading-relaxed text-slate-600">{msg}</p>}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Plus className="w-4 h-4 text-indigo-600" /> 新增活動代碼
          </h3>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600">代碼（英文數字，例 event03）</label>
              <input value={newSlug} onChange={(e) => setNewSlug(e.target.value)}
                placeholder="event03"
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono bg-white outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="text-xs text-slate-600">活動名稱</label>
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                placeholder="中秋晚會報名"
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white outline-none focus:border-indigo-300" />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-slate-600">初始目標網址</label>
            <input value={newTarget} onChange={(e) => setNewTarget(e.target.value)}
              placeholder="https://example.com/signup"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white outline-none focus:border-indigo-300" />
          </div>
          <button onClick={handleAdd}
            className="mt-3 px-4 py-2.5 rounded-xl bg-white border border-indigo-200 text-indigo-700 text-sm font-semibold hover:bg-indigo-50">
            新增活動
          </button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <FileDown className="w-4 h-4" /> 要讓所有人生效（公開上線三步驟）
          </h3>
          <ol className="mt-2 text-xs leading-relaxed text-amber-900 list-decimal list-inside space-y-1">
            <li>按下方按鈕下載最新的 <span className="font-mono">links.json</span></li>
            <li>覆蓋 <span className="font-mono">qr-platform/client/public/links.json</span> 後 commit + push 到 main</li>
            <li>GitHub Actions 重部署完成後，所有掃描者即導向新網址，QR 圖不需重印</li>
          </ol>
          <button onClick={handleDownloadJson}
            className="mt-3 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 inline-flex items-center gap-1.5">
            <Download className="w-4 h-4" /> 下載 links.json
          </button>
        </div>
      </div>

      {/* Right: Preview */}
      <div className="lg:sticky lg:top-[76px] h-fit">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <QrCode className="w-4 h-4 text-indigo-600" /> 活動 QR（印出後永久有效）
            </h3>
            <span className={`text-xs px-2 py-1 rounded-full border ${modified ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
              {modified ? '本機已修改·待上線' : '與已發佈一致'}
            </span>
          </div>
          <div className="p-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 flex items-center justify-center min-h-[360px]">
              {selected ? (
                <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200">
                  <canvas ref={canvasRef} className="block max-w-full h-auto" style={{ width: 320, height: 320 }} />
                </div>
              ) : (
                <p className="text-sm text-slate-500">尚無活動代碼，請先新增</p>
              )}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={handleDownloadPNG} disabled={!selected}
                className="inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                <Download className="w-4 h-4" /> 下載 PNG
              </button>
              <button onClick={handleDownloadSVG} disabled={!selected}
                className="inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-white border border-slate-200 text-slate-800 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                <Download className="w-4 h-4" /> 下載 SVG
              </button>
            </div>
            <p className="mt-3 text-xs text-center text-slate-500">
              此 QR 內容是固定短碼連結，之後改目標網址不用重印、不用重發。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
