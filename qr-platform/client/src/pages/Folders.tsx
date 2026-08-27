import { useEffect, useState } from 'react';
import { Folder, Edit2, Trash2, Plus, FolderOpen } from 'lucide-react';
import { api, Folder as FolderType } from '../utils/api';
import { Link } from 'react-router-dom';

export default function Folders() {
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  useEffect(() => { api.listFolders().then(setFolders); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const f = await api.createFolder(newName.trim(), newColor);
    setFolders((p) => [...p, f]);
    setNewName('');
  };

  const handleUpdate = async (id: string) => {
    await api.updateFolder(id, { name: editName, color: editColor });
    setFolders((p) => p.map((f) => f.id === id ? { ...f, name: editName, color: editColor } : f));
    setEditing(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`確定刪除資料夾「${name}」？內含 QR Code 將移至未分類。`)) return;
    await api.deleteFolder(id);
    setFolders((p) => p.filter((f) => f.id !== id));
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">分類資料夾管理</h1>

      {/* Add new */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-6">
        <div className="flex items-center gap-3">
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="新資料夾名稱..." onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)}
            className="w-9 h-9 border rounded cursor-pointer" />
          <button onClick={handleCreate}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
            <Plus className="w-4 h-4" /> 新增
          </button>
        </div>
      </div>

      {/* List */}
      <div className="grid grid-cols-3 gap-4">
        {folders.map((f) => (
          <div key={f.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
            {editing === f.id ? (
              <div className="space-y-3">
                <input value={editName} onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                <div className="flex gap-2">
                  <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)}
                    className="w-9 h-9 border rounded cursor-pointer" />
                  <button onClick={() => handleUpdate(f.id)}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs">儲存</button>
                  <button onClick={() => setEditing(null)}
                    className="px-3 py-1.5 border rounded text-xs">取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-lg" style={{ backgroundColor: f.color + '20' }}>
                      <FolderOpen className="w-5 h-5" style={{ color: f.color }} />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{f.name}</div>
                      <div className="text-xs text-gray-400">{f.qrcode_count ?? 0} 個 QR Code</div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditing(f.id); setEditName(f.name); setEditColor(f.color); }}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
                    <Edit2 className="w-3 h-3" /> 編輯
                  </button>
                  <button onClick={() => handleDelete(f.id, f.name)}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600">
                    <Trash2 className="w-3 h-3" /> 刪除
                  </button>
                  <Link to={`/qrcodes?folder=${f.id}`}
                    className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 ml-auto">
                    檢視 QR Code
                  </Link>
                </div>
              </>
            )}
          </div>
        ))}
        {folders.length === 0 && (
          <div className="col-span-3 text-center py-16 text-gray-400">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>尚無資料夾，請建立第一個</p>
          </div>
        )}
      </div>
    </div>
  );
}
