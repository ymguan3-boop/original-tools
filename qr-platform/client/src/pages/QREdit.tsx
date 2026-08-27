import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, Download, Copy, QrCode as QrIcon } from 'lucide-react';
import { api, QRCode, Folder, ScanStats } from '../utils/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

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

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function QREdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [qr, setQr] = useState<QRCode | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [title, setTitle] = useState('');
  const [linkType, setLinkType] = useState('url');
  const [target, setTarget] = useState('');
  const [folderId, setFolderId] = useState('');
  const [status, setStatus] = useState('active');
  const [fgColor, setFgColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [logoPreview, setLogoPreview] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [cacheBust, setCacheBust] = useState(0);
  const [tab, setTab] = useState<'edit' | 'stats'>('edit');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    api.getQRCode(id).then((q) => {
      setQr(q);
      setTitle(q.title);
      setLinkType(q.link_type);
      setTarget(q.target);
      setFolderId(q.folder_id || '');
      setStatus(q.status);
      const app = JSON.parse(q.appearance || '{}');
      if (app.fgColor) setFgColor(app.fgColor);
      if (app.bgColor) setBgColor(app.bgColor);
    });
    api.listFolders().then(setFolders);
    api.getScanStats(id).then(setStats);
  }, [id]);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  };

  const handleSave = async () => {
    if (!id || !title) return;
    setSaving(true);
    try {
      let logoUrl = qr ? JSON.parse(qr.appearance || '{}').logoUrl || '' : '';
      if (logoFile) {
        const upload = await api.uploadFile(logoFile);
        logoUrl = upload.url;
      }
      await api.updateQRCode(id, {
        title, linkType, target,
        folderId: folderId || undefined,
        status,
        appearance: { fgColor, bgColor, logoUrl },
      });
      // Refetch to get updated timestamps + refresh scan URL display
      const updated = await api.getQRCode(id);
      setQr(updated);
      setCacheBust(Date.now());
      alert('已更新');
    } catch (err: any) {
      alert('更新失敗：' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    if (!qr) return;
    navigator.clipboard.writeText(qr.target);
    alert('已複製目標連結');
  };

  if (!qr) return <div className="p-8 animate-pulse">Loading...</div>;

  const scanData = stats?.byDay?.map((d) => ({ day: d.day, 掃瞄次數: d.cnt })) || [];
  const deviceData = stats?.byDevice?.map((d) => ({ name: d.device_type === 'mobile' ? '手機' : d.device_type === 'tablet' ? '平板' : '電腦', value: d.cnt })) || [];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{qr.title}</h1>
          <p className="text-sm text-gray-400 mt-1">ID: {qr.short_id}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">
            <Copy className="w-4 h-4" /> 複製連結
          </button>
          <a href={api.getQRImageUrl(qr.id, cacheBust)} download={`${qr.short_id}.png`}
            className="flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">
            <Download className="w-4 h-4" /> 下載 PNG
          </a>
        </div>
      </div>

      {/* QR Preview */}
      <div className="flex items-center gap-6 mb-6 bg-white rounded-xl p-4 border border-gray-100">
        <img src={api.getQRImageUrl(qr.id, cacheBust)} alt={qr.title} className="w-24 h-24 rounded-lg" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-500">目標連結</div>
          <div className="text-sm text-indigo-600 truncate" title={qr.target}>{qr.target}</div>
          <div className="text-xs text-gray-400 mt-1">
            建立於 {qr.created_at?.replace('T', ' ')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900">{qr.scan_count ?? 0}</div>
          <div className="text-xs text-gray-400">總掃瞄次數</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-100 w-fit">
        <button onClick={() => setTab('edit')} className={`px-4 py-2 text-sm rounded-md ${tab === 'edit' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>編輯</button>
        <button onClick={() => setTab('stats')} className={`px-4 py-2 text-sm rounded-md ${tab === 'stats' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>數據分析</button>
      </div>

      {tab === 'edit' ? (
        <div className="grid grid-cols-5 gap-8">
          <div className="col-span-3 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">標題</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">連結類型</label>
              <select value={linkType} onChange={(e) => setLinkType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200">
                {LINK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">目標內容/連結</label>
              <textarea value={target} onChange={(e) => setTarget(e.target.value)} rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">分類資料夾</label>
                <select value={folderId} onChange={(e) => setFolderId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200">
                  <option value="">無</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">狀態</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200">
                  <option value="active">啟用</option>
                  <option value="inactive">停用</option>
                </select>
              </div>
            </div>
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
                <div onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-indigo-300 transition-colors">
                  {logoPreview ? <img src={logoPreview} alt="logo" className="h-16 mx-auto" />
                    : <div className="text-gray-400"><Upload className="w-6 h-6 mx-auto mb-1" /><span className="text-xs">更換 Logo</span></div>}
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoSelect} className="hidden" />
                </div>
              </div>
            </div>
            <button onClick={handleSave} disabled={saving}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
              {saving ? '儲存中...' : '儲存變更'}
            </button>
          </div>
          <div className="col-span-2">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 sticky top-8">
              <h3 className="text-sm font-medium text-gray-700 mb-4">即時預覽</h3>
              <div className="bg-gray-50 rounded-lg p-4 flex items-center justify-center">
                <img src={api.getQRImageUrl(qr.id, cacheBust)} alt="QR" className="max-w-full max-h-48" />
              </div>
              <div className="text-center text-xs text-gray-400 mt-3">掃瞄後將重新導向至目標連結</div>
            </div>
          </div>
        </div>
      ) : (
        /* Stats tab */
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: '總掃瞄次數', value: stats?.total ?? 0, color: 'text-indigo-600' },
              { label: '裝置類型', value: deviceData.length, color: 'text-emerald-600' },
              { label: '瀏覽器', value: stats?.byBrowser?.length ?? 0, color: 'text-amber-600' },
              { label: '作業系統', value: stats?.byOs?.length ?? 0, color: 'text-rose-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl p-4 border border-gray-100">
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-gray-500 mt-1">{label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-5 border border-gray-100">
              <h3 className="font-medium text-gray-900 mb-4">掃瞄趨勢</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={scanData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5) || ''} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="掃瞄次數" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100">
              <h3 className="font-medium text-gray-900 mb-4">裝置分佈</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={deviceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {deviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
