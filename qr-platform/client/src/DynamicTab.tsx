import { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import {
  QrCode, Download, Copy, Check, ExternalLink,
  RotateCcw, Link2, Upload, KeyRound, Printer,
  MousePointerClick, ShieldCheck,
} from 'lucide-react';
import {
  fixedLinkFor, testLinkFor, loadOverrides, saveOverrides,
  loadActivities, buildLinksJson, todayStr, isValidHttpUrl,
} from './dynamicQr';
import type { ActivityMap } from './dynamicQr';

/** 全站只用這一張固定 QR，代碼永遠不變 */
const FIXED_CODE = 'event01';

const GH_REPO = 'ymguan3-boop/original-tools';
const GH_PATH = 'qr-platform/client/public/links.json';
const GH_BRANCH = 'main';
const GH_FOLDER_URL = `https://github.com/${GH_REPO}/tree/${GH_BRANCH}/qr-platform/client/public`;
const GH_TOKEN_URL = 'https://github.com/settings/tokens?type=beta';

/** 自動確認：每幾秒檢查一次，最多檢查幾次 */
const CHECK_EVERY_SEC = 15;
const FIRST_CHECK_SEC = 5;
const MAX_CHECKS = 20;

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

async function readGhMessage(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (j && typeof j.message === 'string') return j.message;
  } catch {
    /* 忽略 */
  }
  return `HTTP ${res.status}`;
}

/** 把 GitHub 的英文錯誤翻成白話 */
function explainGh(message: string, status: number): string {
  if (/bad credentials/i.test(message)) return '鑰匙不正確或過期了，請重新產生一把再貼上。';
  if (/resource not accessible/i.test(message))
    return '鑰匙沒有寫入權限。請重做一把：Repository access 要勾 original-tools，Permissions 的 Contents 要選 Read and write。';
  if (status === 404 || /not found/i.test(message))
    return '找不到檔案或 repo，可能是鑰匙沒勾 original-tools。請重做一把再試。';
  return `GitHub 說：${message}`;
}

function StepBadge({ n }: { n: string }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0">
      {n}
    </span>
  );
}

export default function DynamicTab() {
  const [activities, setActivities] = useState<ActivityMap | null>(null);
  const [loadError, setLoadError] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>(() => loadOverrides());
  const [editTarget, setEditTarget] = useState('');
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [pat, setPat] = useState(() => window.localStorage.getItem('qr-gh-pat') || '');
  const [showPat, setShowPat] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pubMsg, setPubMsg] = useState('');
  const [lastUploaded, setLastUploaded] = useState('');
  const lastUploadedRef = useRef('');
  const [checkingLive, setCheckingLive] = useState(false);
  const [liveMsg, setLiveMsg] = useState('');
  const [autoChecking, setAutoChecking] = useState(false);
  const [checkCount, setCheckCount] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [checking, setChecking] = useState(false);
  const [dataUrl, setDataUrl] = useState('');
  const [qrError, setQrError] = useState('');

  const fixedLink = fixedLinkFor(FIXED_CODE);
  const publishedTarget = activities?.[FIXED_CODE]?.target || '';
  const localTarget = overrides[FIXED_CODE] || publishedTarget;
  const modified = FIXED_CODE in overrides;
  const editValid = isValidHttpUrl(editTarget);

  // 載入已公開的網址
  useEffect(() => {
    loadActivities()
      .then((map) => {
        setActivities(map);
        const ov = loadOverrides();
        setEditTarget(ov[FIXED_CODE] || map[FIXED_CODE]?.target || '');
      })
      .catch((e: any) => setLoadError(e?.message || '載入失敗'));
  }, []);

  // QR 圖只跟固定地址有關；用圖片方式產生，失敗會顯示原因
  const generateQR = useCallback(async () => {
    setQrError('');
    try {
      const du = await QRCode.toDataURL(fixedLink, {
        width: 1024, margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      setDataUrl(du);
    } catch (e: any) {
      setQrError(e?.message || 'QR 產生失敗');
    }
  }, [fixedLink]);

  useEffect(() => { generateQR(); }, [generateQR]);

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
    if (!editValid || !activities) return;
    const next = { ...overrides, [FIXED_CODE]: editTarget.trim() };
    setOverrides(next);
    saveOverrides(next);
    setActivities({
      ...activities,
      [FIXED_CODE]: { ...activities[FIXED_CODE], target: editTarget.trim(), updatedAt: todayStr() },
    });
    setMsg('存好了！接著做第 3 步按按看。提醒：這時只有你這台電腦看得到，手機要換請繼續做第 4 步。');
  };

  const handleRevert = () => {
    const next = { ...overrides };
    delete next[FIXED_CODE];
    setOverrides(next);
    saveOverrides(next);
    setEditTarget(publishedTarget);
    setMsg('已恢復成大家目前看到的版本。');
  };

  const buildMerged = (): ActivityMap | null => {
    if (!activities) return null;
    const merged: ActivityMap = { ...activities };
    for (const [k, v] of Object.entries(overrides)) {
      if (merged[k]) merged[k] = { ...merged[k], target: v, updatedAt: todayStr() };
      else merged[k] = { label: k, target: v, updatedAt: todayStr() };
    }
    return merged;
  };

  const handleCheckKey = async () => {
    const token = pat.trim();
    if (!token) { setPubMsg('請先貼上鑰匙，才能檢查。'); return; }
    setChecking(true);
    setPubMsg('檢查中…');
    try {
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
      const meRes = await fetch('https://api.github.com/user', { headers });
      if (!meRes.ok) {
        setPubMsg(explainGh(await readGhMessage(meRes), meRes.status));
        return;
      }
      const me = await meRes.json();
      const fileRes = await fetch(
        `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}`,
        { headers },
      );
      if (fileRes.ok) {
        setPubMsg(`鑰匙有效！你是 ${me.login}，也讀得到設定檔，權限沒問題，可以按「公開上線」。`);
      } else {
        setPubMsg(`鑰匙有效（你是 ${me.login}），但讀不到設定檔：${explainGh(await readGhMessage(fileRes), fileRes.status)}`);
      }
    } catch {
      setPubMsg('檢查失敗，請檢查網路後再試。');
    } finally {
      setChecking(false);
    }
  };

  const handlePublish = async () => {
    const merged = buildMerged();
    if (!merged) return;
    const token = pat.trim();
    if (!token) { setPubMsg('請先貼上鑰匙（Token），才能公開上線。'); return; }
    setPublishing(true);
    setPubMsg('上傳中，請稍等…');
    try {
      const apiUrl = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      };
      let sha: string | undefined;
      const getRes = await fetch(`${apiUrl}?ref=${GH_BRANCH}`, { headers });
      if (getRes.ok) {
        sha = (await getRes.json()).sha;
      } else if (getRes.status !== 404) {
        throw new Error(explainGh(await readGhMessage(getRes), getRes.status));
      }
      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `更新活動連結（${todayStr()}）`,
          content: utf8ToBase64(buildLinksJson(merged)),
          branch: GH_BRANCH,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!putRes.ok) throw new Error(explainGh(await readGhMessage(putRes), putRes.status));
      window.localStorage.setItem('qr-gh-pat', token);
      const uploadedTarget = merged[FIXED_CODE].target;
      setLastUploaded(uploadedTarget);
      lastUploadedRef.current = uploadedTarget;
      const nov = { ...overrides };
      delete nov[FIXED_CODE];
      setOverrides(nov);
      saveOverrides(nov);
      setPubMsg('上傳成功！正在自動確認網站更新好了沒，你不用一直按，等著看結果就好。');
      setCheckCount(0);
      setCountdown(FIRST_CHECK_SEC);
      setAutoChecking(true);
      setLiveMsg(`已送出，${FIRST_CHECK_SEC} 秒後開始自動確認…`);
    } catch (e: any) {
      setPubMsg(e?.message || '上傳失敗，請檢查網路後再試。');
    } finally {
      setPublishing(false);
    }
  };

  /** 讀一次線上設定檔：回傳 ok（已更新好）/ pending（還在更新）/ error（讀不到） */
  const checkLiveSite = useCallback(async (expect: string): Promise<'ok' | 'pending' | 'error'> => {
    try {
      const base = import.meta.env.BASE_URL || '/';
      const res = await fetch(`${base}links.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return 'error';
      const data = await res.json();
      const live = data?.links?.[FIXED_CODE]?.target || '';
      return live && expect && live === expect ? 'ok' : 'pending';
    } catch {
      return 'error';
    }
  }, []);

  /** 自動確認迴圈：倒數 → 檢查 → 還沒好就再倒數，直到更新好或超過次數 */
  useEffect(() => {
    if (!autoChecking) return;
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    (async () => {
      const n = checkCount + 1;
      setLiveMsg(`確認中…（第 ${n} 次檢查）`);
      const result = await checkLiveSite(lastUploadedRef.current);
      if (cancelled) return;
      if (result === 'ok') {
        setLiveMsg(`網站已更新好！現在手機掃就會到：${lastUploadedRef.current}`);
        setAutoChecking(false);
      } else if (n >= MAX_CHECKS) {
        setLiveMsg('等超過 5 分鐘還沒更新好，可能是網站部署卡住了，請稍後再按一次檢查。');
        setAutoChecking(false);
      } else {
        setCheckCount(n);
        setCountdown(CHECK_EVERY_SEC);
        setLiveMsg(`確認中…網站還在更新（第 ${n} 次檢查），${CHECK_EVERY_SEC} 秒後自動再檢查，不用按。`);
      }
    })();
    return () => { cancelled = true; };
  }, [autoChecking, countdown, checkCount, checkLiveSite]);

  const handleCheckLive = async () => {
    const expect = lastUploaded || localTarget;
    if (!expect) { setLiveMsg('還沒有上傳過，先做第 2 步儲存、第 4 步公開上線。'); return; }
    setCheckingLive(true);
    setLiveMsg('檢查中…');
    const result = await checkLiveSite(expect);
    setCheckingLive(false);
    if (result === 'ok') {
      setLiveMsg(`網站已更新好！現在手機掃就會到：${expect}`);
      setAutoChecking(false);
    } else if (result === 'pending') {
      try {
        const base = import.meta.env.BASE_URL || '/';
        const res = await fetch(`${base}links.json?t=${Date.now()}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        const live = data?.links?.[FIXED_CODE]?.target || '';
        setLiveMsg(live
          ? `網站還在更新中，目前還是舊的。等一下再按一次檢查。（網站目前：${live}）`
          : '網站還沒準備好，請稍後再按一次檢查。');
      } catch {
        setLiveMsg('網站還在更新中，等一下再按一次檢查。');
      }
    } else {
      setLiveMsg('檢查失敗，請檢查網路後再試。');
    }
  };

  const handleDownloadPNG = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = '活動QR.png';
    a.click();
  };

  const handleDownloadSVG = async () => {
    const svg: string = await QRCode.toString(fixedLink, {
      type: 'svg', margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    } as any) as unknown as string;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = '活動QR.svg';
    a.click();
    URL.revokeObjectURL(href);
  };

  if (loadError) {
    return (
      <div className="bg-white rounded-2xl border border-red-200 p-6 text-sm text-red-700">
        活動資料讀不到：{loadError}。請等網站更新完成後再重新整理試試。
      </div>
    );
  }
  if (!activities) {
    return <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">載入中…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
        <p className="text-sm leading-relaxed text-indigo-900">
          這一頁只有 <span className="font-bold">一張 QR</span>，從上往下照著 1 → 4 做就行。
          這張圖印出去後就不用再換，以後網址換了，舊圖照樣能用。
        </p>
      </div>

      {/* 第 1 步 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <StepBadge n="1" /> <Printer className="w-4 h-4 text-indigo-600" /> 把這張 QR 印出來
        </h3>
        <p className="mt-1 text-xs text-slate-500">這張圖永遠不變，先印沒關係，儘管貼出去。</p>
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 flex items-center justify-center min-h-[300px]">
          {dataUrl ? (
            <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200">
              <img src={dataUrl} alt="活動 QR Code" className="block max-w-full h-auto" style={{ width: 260, height: 260 }} />
            </div>
          ) : qrError ? (
            <div className="text-center max-w-sm">
              <p className="text-sm text-red-600">QR 產生失敗：{qrError}</p>
              <button
                onClick={generateQR}
                className="mt-3 px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-medium hover:bg-slate-50"
              >
                重新產生
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-400">QR 產生中…</p>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            readOnly
            value={fixedLink}
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-[11px] font-mono bg-slate-50 text-slate-600 outline-none"
          />
          <button
            onClick={() => copyText(fixedLink)}
            className="px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium inline-flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? '已複製' : '複製'}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={handleDownloadPNG} disabled={!dataUrl}
            className="inline-flex items-center justify-center gap-1.5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
            <Download className="w-4 h-4" /> 下載圖片拿去印
          </button>
          <button onClick={handleDownloadSVG} disabled={!dataUrl}
            className="inline-flex items-center justify-center gap-1.5 py-3 rounded-xl bg-white border border-slate-200 text-slate-800 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="w-4 h-4" /> 下載向量檔
          </button>
        </div>
      </div>

      {/* 第 2 步 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <StepBadge n="2" /> <Link2 className="w-4 h-4 text-indigo-600" /> 貼上要給大家看的網頁
              {modified && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">已儲存</span>
              )}
        </h3>
        <input
          value={editTarget}
          onChange={(e) => setEditTarget(e.target.value)}
          placeholder="把網址貼在這裡，例如 https://www.youtube.com/..."
          className={`mt-3 w-full px-4 py-3 rounded-xl border text-sm outline-none transition bg-white
            ${editValid || !editTarget.trim() ? 'border-slate-200 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50' : 'border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-50'}`}
        />
        {!editValid && editTarget.trim() && (
          <p className="mt-2 text-xs text-red-600">網址怪怪的，記得前面要有 http:// 或 https://</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={handleSaveLocal}
            disabled={!editValid}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
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

      {/* 第 3 步 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <StepBadge n="3" /> <MousePointerClick className="w-4 h-4 text-indigo-600" /> 按按看，確認會連到哪裡
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          目前按下去會到：<span className="font-mono break-all">{localTarget || '（還沒設定）'}</span>
        </p>
        <a
          href={testLinkFor(FIXED_CODE)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 px-6 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 shadow-sm"
        >
          開新分頁試試看 <ExternalLink className="w-4 h-4" />
        </a>
        <p className="mt-2 text-xs text-slate-500">對了再做第 4 步，不對就回第 2 步重貼。</p>
      </div>

      {/* 第 4 步 */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <StepBadge n="4" /> 讓大家的手機都連到新網址
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-amber-900">
          為什麼手機掃了還沒換？因為第 2 步的「儲存」只存在你這台電腦。
          要讓所有手機都換，請按下面的「公開上線」，等約 1 分鐘就好，舊 QR 不用重印。
        </p>
        <div className="mt-3 bg-white/70 rounded-xl border border-amber-200 p-3">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <KeyRound className="w-3.5 h-3.5" /> 上傳用的鑰匙（第一次用才需要，以後不用再貼）
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type={showPat ? 'text' : 'password'}
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="貼上 GitHub Token，例如 github_pat_…"
              className="flex-1 px-3 py-2.5 rounded-xl border border-amber-200 text-xs font-mono bg-white outline-none focus:border-amber-400"
            />
            <button
              onClick={() => setShowPat(!showPat)}
              className="px-3 rounded-xl border border-amber-200 bg-white text-xs text-amber-900"
            >
              {showPat ? '隱藏' : '顯示'}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-amber-800">
            還沒有鑰匙？<a href={GH_TOKEN_URL} target="_blank" rel="noreferrer" className="underline font-semibold">按這裡去 GitHub 產生一把</a>：
            選 Fine-grained tokens → Generate new token → 下面 Repository access 選 Only select repositories 並勾 original-tools →
            Permissions 找到 Contents 選 Read and write → 按 Generate，複製那串字回來貼上。
            <span className="font-semibold">最常見失敗原因就是這裡沒勾到，鑰匙等於沒有寫入權限。</span>
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={handleCheckKey} disabled={checking}
            className="px-4 py-2.5 rounded-xl bg-white border border-amber-300 text-amber-900 text-sm font-medium hover:bg-amber-100/50 disabled:opacity-50 inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> {checking ? '檢查中…' : '檢查鑰匙'}
          </button>
          <button onClick={handlePublish} disabled={publishing}
            className="px-6 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 inline-flex items-center gap-1.5">
            <Upload className="w-4 h-4" /> {publishing ? '上傳中…' : '公開上線'}
          </button>
        </div>
          {pubMsg && <p className="mt-2 text-xs leading-relaxed text-amber-900">{pubMsg}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={handleCheckLive} disabled={checkingLive}
              className="px-4 py-2.5 rounded-xl bg-white border border-amber-300 text-amber-900 text-sm font-medium hover:bg-amber-100/50 disabled:opacity-50 inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> {checkingLive ? '檢查中…' : '檢查網站更新好了沒'}
            </button>
          </div>
          {liveMsg && <p className="mt-2 text-xs leading-relaxed text-amber-900">{liveMsg}</p>}
        <p className="mt-2 text-[11px] text-amber-800">
          想自己動手也可以：<a href={GH_FOLDER_URL} target="_blank" rel="noreferrer" className="underline">直接打開 GitHub 資料夾上傳覆蓋 <ExternalLink className="w-3 h-3 inline" /></a>
        </p>
        <p className="mt-1 text-[11px] text-amber-800 flex items-center gap-1">
          <QrCode className="w-3 h-3" /> 目前大家掃到的是：<span className="font-mono break-all">{publishedTarget || '（讀取中）'}</span>
        </p>
      </div>
    </div>
  );
}
