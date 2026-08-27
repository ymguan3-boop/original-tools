import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, Edit2, Trash2, ExternalLink, Download, Copy } from 'lucide-react';
import { api, QRCode, Folder } from '../utils/api';

export default function QRCodes() {
  const [qrs, setQrs] = useState<QRCode[]>([]);
  const [total, setTotal] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [folderFilter, setFolderFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const f = searchParams.get('folder');
    if (f) setFolderFilter(f);
  }, [searchParams]);

  useEffect(() => { api.listFolders().then(setFolders); }, []);

  useEffect(() => {
    setLoading(true);
    api.listQRCodes({ folderId: folderFilter || undefined, search: search || undefined, page, limit: 15 })
      .then((r) => { setQrs(r.items); setTotal(r.total); })
      .finally(() => setLoading(false));
  }, [folderFilter, search, page]);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`確定刪除「${title}」？此操作不可復原。`)) return;
    await api.deleteQRCode(id);
    setQrs((p) => p.filter((q) => q.id !== id));
  };

  const handleCopy = (target: string) => {
    navigator.clipboard.writeText(target);
    alert('已複製目標連結');
  };

  const getFolderName = (id: string | null) => folders.find((f) => f.id === id)?.name || '未分類';

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">QR Code 列表</h1>
        <Link to="/qrcodes/new" className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
          <Plus className="w-4 h-4" /> 新增 QR Code
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" placeholder="搜尋標題或連結..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <select
          value={folderFilter} onChange={(e) => { setFolderFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
        >
          <option value="">全部資料夾</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">Loading...</div>
      ) : qrs.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">尚無 QR Code</p>
          <Link to="/qrcodes/new" className="text-indigo-600 hover:text-indigo-700 text-sm">新增第一個</Link>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">標題</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">類型</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">資料夾</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">掃瞄</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">狀態</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody>
                {qrs.map((qr) => (
                  <tr key={qr.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <img src={api.getQRImageUrl(qr.id)} alt="" className="w-10 h-10 rounded" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">{qr.title}</div>
                          <div className="text-xs text-gray-400 truncate max-w-[300px]" title={qr.target}>{qr.target}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-600">{qr.link_type}</td>
                    <td className="px-4 py-4">
                      <span className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600">
                        {getFolderName(qr.folder_id)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center text-sm text-gray-900 font-medium">{qr.scan_count ?? 0}</td>
                    <td className="px-4 py-4 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        qr.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {qr.status === 'active' ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleCopy(qr.target)} className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600" title="複製目標連結">
                          <Copy className="w-4 h-4" />
                        </button>
                        <a href={api.getQRImageUrl(qr.id)} download={`${qr.short_id}.png`} className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600" title="下載 PNG">
                          <Download className="w-4 h-4" />
                        </a>
                        <Link to={`/qrcodes/${qr.id}/edit`} className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600" title="編輯">
                          <Edit2 className="w-4 h-4" />
                        </Link>
                        <button onClick={() => handleDelete(qr.id, qr.title)} className="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500" title="刪除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>共 {total} 筆</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 border rounded disabled:opacity-40 hover:bg-gray-50">上一頁</button>
              <button disabled={page * 15 >= total} onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 border rounded disabled:opacity-40 hover:bg-gray-50">下一頁</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
