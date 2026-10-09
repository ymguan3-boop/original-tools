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
    setMsg('存好了！你自己現在掃就會連到新網頁。要讓別人的手機也連到新網頁，請繼續做最下面的「第 4 步」。');
  };

  const handleRevert = () => {
    if (!selected) return;
    const next = { ...overrides };
    delete next[selected];
    setOverrides(next);
    saveOverrides(next);
    setMsg('已恢復成大家目前看到的版本。');
  };

  const handleAdd = () => {
    const slug = newSlug.trim();
    if (!isValidSlug(slug)) { setMsg('代碼只能用英文、數字、-、_，長度 2 到 32 個字，例如 event03'); return; }
    if (!newLabel.trim()) { setMsg('請幫這張 QR 取個名字，例如「中秋晚會報名」'); return; }
    if (!isValidHttpUrl(newTarget)) { setMsg('網址怪怪的，記得前面要有 https://'); return; }
    if (activities && activities[slug]) { setMsg(`代碼 ${slug} 已經有人用了，換一個吧`); return; }
    const entry = { label: newLabel.trim(), target: newTarget.trim(), updatedAt: todayStr() };
    setActivities({ ...(activities || {}), [slug]: entry });
    const next = { ...overrides, [slug]: entry.target };
    setOverrides(next);
    saveOverrides(next);
    setSelected(slug);
    setNewSlug(''); setNewLabel(''); setNewTarget('');
    setMsg(`新增好了！記得做最下面的「第 4 步」，大家才掃得到。`);
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
        活動清單讀不到：{loadError}。請等網站更新完成後再重新整理試試。
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
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-indigo-900">怎麼用？照著做就行（共 4 步）</h3>
          <ol className="mt-2 text-xs leading-relaxed text-indigo-900 list-decimal list-inside space-y-1">
            <li><span className="font-semibold">選一張 QR</span>：下面選一張，沒有就加一張新的</li>
            <li><span className="font-semibold">貼上網頁</span>：把要給大家看的網址貼上，按「儲存」</li>
            <li><span className="font-semibold">印出來</span>：把右邊的 QR 下載、印出來貼出去</li>
            <li><span className="font-semibold">以後換網址</span>：回來改一改，照最下面的第 4 步上傳，舊圖繼續用、不用重印</li>
          </ol>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Repeat className="w-4 h-4 text-indigo-600" /> 第 1 步：選一張 QR
          </label>
          <select
            value={selected}
            onChange={(e) => { setSelected(e.target.value); setMsg(''); }}
            className="mt-2 w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-white outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
          >
            {codes.map((c) => (
              <option key={c} value={c}>
                {c} — {activities[c].label}{overrides[c] ? '（剛改好，還沒公開）' : ''}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500">
            一張 QR 就是一個代碼。選好之後，掃這張 QR 會看到的網頁，就是下面第 2 步設定的。
          </p>
        </div>

        {selected && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <QrCode className="w-4 h-4 text-indigo-600" /> 這張 QR 的地址（固定不變，不用改）
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
              按我試試看會連到哪裡 <ExternalLink className="w-3 h-3" />
            </a>
            <p className="mt-1 text-xs text-slate-500">
              掃 QR 的人會先到這個地址，再自動轉到你要的網頁，所以這個地址永遠不用換。
            </p>
          </div>
        )}

        {selected && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Link2 className="w-4 h-4 text-indigo-600" /> 第 2 步：要給大家看的網頁
              {modified && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">剛改好，還沒公開</span>
              )}
            </label>
            <input
              value={editTarget}
              onChange={(e) => setEditTarget(e.target.value)}
              placeholder="把網址貼在這裡，例如 https://example.com/signup"
              className={`mt-2 w-full px-4 py-3 rounded-xl border text-sm outline-none transition bg-white
                ${editValid || !editTarget.trim() ? 'border-slate-200 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50' : 'border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-50'}`}
            />
            {!editValid && editTarget.trim() && (
              <p className="mt-2 text-xs text-red-600">網址怪怪的，記得前面要有 http:// 或 https://</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleSaveLocal}
                disabled={!editValid}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                儲存
              </button>
              {modified && (
                <button
                  onClick={handleRevert}
                  className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> 取消修改，恢復公開的版本
                </button>
              )}
            </div>
            {msg && <p className="mt-2 text-xs leading-relaxed text-slate-600">{msg}</p>}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Plus className="w-4 h-4 text-indigo-600" /> 加一張新的 QR
          </h3>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600">代碼（自己編，例如 event03）</label>
              <input value={newSlug} onChange={(e) => setNewSlug(e.target.value)}
                placeholder="event03"
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono bg-white outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="text-xs text-slate-600">這張 QR 的名字</label>
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                placeholder="中秋晚會報名"
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white outline-none focus:border-indigo-300" />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-slate-600">一開始要連到的網頁</label>
            <input value={newTarget} onChange={(e) => setNewTarget(e.target.value)}
              placeholder="https://example.com/signup"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white outline-none focus:border-indigo-300" />
          </div>
          <button onClick={handleAdd}
            className="mt-3 px-4 py-2.5 rounded-xl bg-white border border-indigo-200 text-indigo-700 text-sm font-semibold hover:bg-indigo-50">
            新增這張 QR
          </button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <FileDown className="w-4 h-4" /> 第 4 步：讓大家的手機都連到新網址
          </h3>
          <ol className="mt-2 text-xs leading-relaxed text-amber-900 list-decimal list-inside space-y-1">
            <li>按下方按鈕，會存一個小檔案（links.json）到你的電腦</li>
            <li>到 GitHub 的 qr-platform/client/public/ 資料夾，把舊檔換成這個新檔（直接在 GitHub 網頁上傳覆蓋就可以），然後等大約 1 分鐘讓網站更新</li>
            <li>好了！舊 QR 不用重印，掃了就會到新網頁</li>
          </ol>
          <button onClick={handleDownloadJson}
            className="mt-3 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 inline-flex items-center gap-1.5">
            <Download className="w-4 h-4" /> 下載設定檔（links.json）
          </button>
        </div>
      </div>

      {/* Right: Preview */}
      <div className="lg:sticky lg:top-[76px] h-fit">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <QrCode className="w-4 h-4 text-indigo-600" /> 第 3 步：這張 QR 拿去印
            </h3>
            <span className={`text-xs px-2 py-1 rounded-full border ${modified ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
              {modified ? '剛改好，還沒公開' : '大家掃到的就是這樣'}
            </span>
          </div>
          <div className="p-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 flex items-center justify-center min-h-[360px]">
              {selected ? (
                <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200">
                  <canvas ref={canvasRef} className="block max-w-full h-auto" style={{ width: 320, height: 320 }} />
                </div>
              ) : (
                <p className="text-sm text-slate-500">還沒有 QR，請先在左邊加一張新的</p>
              )}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={handleDownloadPNG} disabled={!selected}
                className="inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                <Download className="w-4 h-4" /> 下載圖片拿去印（PNG）
              </button>
              <button onClick={handleDownloadSVG} disabled={!selected}
                className="inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-white border border-slate-200 text-slate-800 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                <Download className="w-4 h-4" /> 下載向量檔（SVG）
              </button>
            </div>
            <p className="mt-3 text-xs text-center text-slate-500">
              印出來貼出去就好。以後網址換了，這張舊圖照樣能用，不用重印。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
