import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { QrCode, Download, Link2, Palette, Settings2, ExternalLink, Github, Sparkles } from 'lucide-react';

const DEFAULT_URL = 'https://example.com';

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [fg, setFg] = useState('#0f172a');
  const [bg, setBg] = useState('#ffffff');
  const [size, setSize] = useState(320);
  const [margin, setMargin] = useState(2);
  const [level, setLevel] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState('');

  const valid = isValidUrl(url.trim());

  const renderQR = useCallback(async () => {
    const target = url.trim();
    if (!target || !valid || !canvasRef.current) return;
    try {
      await QRCode.toCanvas(canvasRef.current, target, {
        width: size,
        margin,
        color: { dark: fg, light: bg },
        errorCorrectionLevel: level,
      });
      // also generate data URL for download fallback
      const du = await QRCode.toDataURL(target, {
        width: 1024,
        margin,
        color: { dark: fg, light: bg },
        errorCorrectionLevel: level,
      });
      setDataUrl(du);
      setError('');
    } catch (e: any) {
      setError(e?.message || '產生失敗');
    }
  }, [url, fg, bg, size, margin, level, valid]);

  useEffect(() => {
    renderQR();
  }, [renderQR]);

  const handleDownloadPNG = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qrcode-${Date.now()}.png`;
    a.click();
  };

  const handleDownloadSVG = async () => {
    const target = url.trim();
    if (!valid) return;
    try {
      const svg: string = await QRCode.toString(target, {
        type: 'svg',
        margin,
        color: { dark: fg, light: bg },
        errorCorrectionLevel: level,
      } as any) as unknown as string;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `qrcode-${Date.now()}.svg`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e: any) {
      setError(e?.message || 'SVG 產生失敗');
    }
  };

  const quickUrls = [
    'https://github.com',
    'https://www.google.com',
    'https://www.youtube.com',
  ];

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-sm">
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold leading-none">QR 連結產生器</div>
              <div className="text-xs text-slate-500">純前端 · 即時產生 · 無需後端</div>
            </div>
          </div>
          <a
            href="https://github.com/ymguan3-boop/qr-platform"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-sm"
          >
            <Github className="w-4 h-4" /> GitHub
          </a>
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium border border-indigo-100">
          <Sparkles className="w-3.5 h-3.5" /> 僅保留「網站連結」QR Code · 專注、輕量、快速
        </div>
        <h1 className="mt-3 text-[28px] sm:text-[32px] font-extrabold tracking-tight text-slate-900">
          輸入網址，一鍵產生 QR Code
        </h1>
        <p className="mt-2 text-slate-600 max-w-2xl">
          支援即時預覽、顏色與尺寸調整，下載高畫質 PNG / SVG。所有運算皆在瀏覽器本地完成，不會上傳任何資料。
        </p>
      </div>

      {/* Main */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6">
        {/* Left: Form */}
        <div className="space-y-5">
          {/* URL Input */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Link2 className="w-4 h-4 text-indigo-600" /> 網站連結 URL
              <span className="text-red-500">*</span>
            </label>
            <div className="mt-2 relative">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className={`w-full px-4 py-3 pr-10 rounded-xl border text-sm outline-none transition
                  ${valid || !url.trim() ? 'border-slate-200 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50' : 'border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-50'}
                  bg-white`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className={`w-2.5 h-2.5 rounded-full ${valid ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">快速填入：</span>
              {quickUrls.map((u) => (
                <button
                  key={u}
                  onClick={() => setUrl(u)}
                  className="text-xs px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                >
                  {u.replace('https://', '')}
                </button>
              ))}
            </div>
            {!valid && url.trim() && (
              <p className="mt-2 text-xs text-red-600">請輸入完整網址，需以 http:// 或 https:// 開頭</p>
            )}
            {valid && (
              <a
                href={url.trim()}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
              >
                開啟連結 <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Appearance */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Palette className="w-4 h-4 text-indigo-600" /> 外觀設定
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-600">前景色</label>
                <div className="mt-1 flex items-center gap-2">
                  <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} className="w-10 h-10 rounded-lg border border-slate-200 p-1 bg-white cursor-pointer" />
                  <input value={fg} onChange={(e) => setFg(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono bg-white" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-600">背景色</label>
                <div className="mt-1 flex items-center gap-2">
                  <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="w-10 h-10 rounded-lg border border-slate-200 p-1 bg-white cursor-pointer" />
                  <input value={bg} onChange={(e) => setBg(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono bg-white" />
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              {[
                { fg: '#0f172a', bg: '#ffffff', label: '經典黑白' },
                { fg: '#4f46e5', bg: '#eef2ff', label: '靛紫' },
                { fg: '#065f46', bg: '#ecfdf5', label: '墨綠' },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setFg(p.fg); setBg(p.bg); }}
                  className="flex-1 py-2 rounded-full border text-xs font-medium bg-white hover:bg-slate-50"
                  style={{ borderColor: p.fg, color: p.fg }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Settings2 className="w-4 h-4 text-indigo-600" /> 進階
            </h3>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-slate-600">尺寸 {size}px</label>
                <input type="range" min={160} max={640} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full mt-2 accent-indigo-600" />
                <div className="text-[11px] text-slate-500 mt-1">預覽尺寸，不影響下載畫質（下載固定 1024px）</div>
              </div>
              <div>
                <label className="text-xs text-slate-600">邊距</label>
                <select value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="mt-2 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white">
                  <option value={0}>0 - 無邊距</option>
                  <option value={1}>1</option>
                  <option value={2}>2 - 預設</option>
                  <option value={4}>4 - 寬鬆</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600">容錯等級</label>
                <select value={level} onChange={(e) => setLevel(e.target.value as any)} className="mt-2 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white">
                  <option value="L">L - 低 (7%)</option>
                  <option value="M">M - 中 (15%)</option>
                  <option value="Q">Q - 高 (25%)</option>
                  <option value="H">H - 最高 (30%)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="lg:sticky lg:top-[76px] h-fit">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <QrCode className="w-4 h-4 text-indigo-600" /> 即時預覽
              </h3>
              <span className={`text-xs px-2 py-1 rounded-full border ${valid ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                {valid ? '可下載' : '等待有效網址'}
              </span>
            </div>

            <div className="p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 flex items-center justify-center min-h-[360px]">
                {valid ? (
                  <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200">
                    <canvas ref={canvasRef} className="block max-w-full h-auto" style={{ width: size, height: size }} />
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="w-20 h-20 mx-auto rounded-2xl bg-white border border-dashed border-slate-300 flex items-center justify-center">
                      <QrCode className="w-8 h-8 text-slate-300" />
                    </div>
                    <p className="mt-3 text-sm text-slate-500">輸入有效網址後自動產生</p>
                    <p className="text-xs text-slate-400">範例：https://example.com</p>
                  </div>
                )}
              </div>

              {error && <p className="mt-3 text-xs text-red-600 text-center">{error}</p>}

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  onClick={handleDownloadPNG}
                  disabled={!valid}
                  className="inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  <Download className="w-4 h-4" /> 下載 PNG
                </button>
                <button
                  onClick={handleDownloadSVG}
                  disabled={!valid}
                  className="inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-white border border-slate-200 text-slate-800 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" /> 下載 SVG
                </button>
              </div>

              <p className="mt-3 text-xs text-center text-slate-500">PNG 為 1024×1024 高畫質，SVG 為向量可無限放大。</p>
            </div>
          </div>

          <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
            <p className="text-xs leading-relaxed text-indigo-900">
              <span className="font-semibold">提示：</span> 此頁面為純靜態網頁，已部署於 GitHub Pages。QR Code 直接在你的瀏覽器中產生，不會將網址傳送至任何伺服器。
            </p>
          </div>
        </div>
      </div>

      <footer className="border-t border-slate-200 py-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} QR 連結產生器 · 僅支援網站連結 QR Code</span>
          <span className="flex items-center gap-2">
            <span>部署於 GitHub Pages</span>
            <span className="w-1 h-1 rounded-full bg-slate-400" />
            <a href="https://github.com/ymguan3-boop/qr-platform" target="_blank" rel="noreferrer" className="hover:text-slate-700 underline">原始碼</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
