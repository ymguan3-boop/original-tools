import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, QrCode } from 'lucide-react';
import { api, Folder } from '../utils/api';

const LINK_TYPES = [
  { value: 'url', label: '網站 URL' },
  { value: 'pdf', label: 'PDF 文件' },
  { value: 'image', label: '圖片/影片' },
  { value: 'wifi', label: 'WiFi 連線' },
  { value: 'vcard', label: '電子名片 (vCard)' },
  { value: 'social', label: '社交媒體' },
  { value: 'menu', label: '餐廳菜單' },
  { value: 'text', label: '純文字' },
];

export default function QRCreate() {
  const navigate = useNavigate();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [title, setTitle] = useState('');
  const [linkType, setLinkType] = useState('url');
  const [target, setTarget] = useState('');
  const [folderId, setFolderId] = useState('');
  const [fgColor, setFgColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.listFolders().then(setFolders); }, []);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  };

  const handleSubmit = async () => {
    if (!title || !target) { alert('請填寫標題與目標連結'); return; }
    setSaving(true);
    try {
      let logoUrl = '';
      if (logoFile) {
        const upload = await api.uploadFile(logoFile);
        logoUrl = upload.url;
      }
      const qr = await api.createQRCode({
        title, linkType, target,
        folderId: folderId || undefined,
        appearance: { fgColor, bgColor, logoUrl },
      });
      navigate(`/qrcodes/${qr.id}/edit`);
    } catch (err: any) {
      alert('建立失敗：' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">新增 QR Code</h1>

      <div className="grid grid-cols-5 gap-8">
        {/* Form */}
        <div className="col-span-3 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">標題 *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              placeholder="例如：官網連結" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">連結類型 *</label>
            <select value={linkType} onChange={(e) => setLinkType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200">
              {LINK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">目標內容/連結 *</label>
            <textarea value={target} onChange={(e) => setTarget(e.target.value)} rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              placeholder={linkType === 'url' ? 'https://example.com' : '輸入內容...'} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分類資料夾</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200">
              <option value="">無（不分類）</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          {/* Appearance */}
          <div className="border-t pt-5">
            <h3 className="font-medium text-gray-900 mb-3">外觀設定</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">前景色</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={fgColor} onChange={(e) => setFgColor(e.target.value)}
                    className="w-10 h-10 border rounded cursor-pointer" />
                  <span className="text-xs text-gray-400">{fgColor}</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">背景色</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)}
                    className="w-10 h-10 border rounded cursor-pointer" />
                  <span className="text-xs text-gray-400">{bgColor}</span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs text-gray-500 mb-1">品牌 Logo</label>
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-indigo-300 transition-colors"
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="logo" className="h-16 mx-auto" />
                ) : (
                  <div className="text-gray-400"><Upload className="w-6 h-6 mx-auto mb-1" /><span className="text-xs">點擊上傳 Logo（建議 200x200）</span></div>
                )}
                <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoSelect} className="hidden" />
              </div>
            </div>
          </div>

          <button onClick={handleSubmit} disabled={saving}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
            {saving ? '建立中...' : '建立 QR Code'}
          </button>
        </div>

        {/* Preview */}
        <div className="col-span-2">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 sticky top-8">
            <h3 className="text-sm font-medium text-gray-700 mb-4">預覽</h3>
            <div className="bg-gray-50 rounded-lg p-4 flex items-center justify-center min-h-[220px]">
              {target ? (
                <img src={`/api/qrcodes/preview?target=${encodeURIComponent(target)}&fg=${encodeURIComponent(fgColor)}&bg=${encodeURIComponent(bgColor)}`}
                  alt="preview" className="max-w-full max-h-48"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <QrCode className="w-16 h-16 text-gray-300" />
              )}
            </div>
            <div className="text-center text-xs text-gray-400 mt-3">建立後可下載 PNG 或 SVG 格式</div>
          </div>
        </div>
      </div>
    </div>
  );
}
