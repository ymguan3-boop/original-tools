import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QrCode, MousePointerClick, FolderOpen, TrendingUp, Plus, ArrowRight } from 'lucide-react';
import { api, DashboardStats } from '../utils/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardStats().then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8"><div className="animate-pulse space-y-4">Loading...</div></div>;

  const cards = [
    { label: 'QR Code 總數', value: stats?.totalQR ?? 0, icon: QrCode, color: 'bg-indigo-500' },
    { label: '活躍中', value: stats?.activeQR ?? 0, icon: TrendingUp, color: 'bg-emerald-500' },
    { label: '掃瞄總次數', value: stats?.totalScans ?? 0, icon: MousePointerClick, color: 'bg-amber-500' },
    { label: '資料夾', value: '—', icon: FolderOpen, color: 'bg-rose-500' },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">儀表板</h1>
          <p className="text-sm text-gray-500 mt-1">QR Code 管理平台概覽</p>
        </div>
        <Link to="/qrcodes/new" className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
          <Plus className="w-4 h-4" /> 新增 QR Code
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-2.5 rounded-lg ${color}`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Chart */}
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4">近 30 日掃瞄趨勢</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={(stats?.scansByDay || []) as any[]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5) || ''} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="cnt" fill="#6366f1" radius={[4, 4, 0, 0]} name="掃瞄次數" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent scans */}
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">最新掃瞄記錄</h3>
            <Link to="/analytics" className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
              查看全部 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {(stats?.recentScans || []).slice(0, 8).map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">{s.title}</div>
                  <div className="text-xs text-gray-400">{s.scanned_at?.replace('T', ' ') || ''}</div>
                </div>
                <div className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600 ml-3 capitalize">{s.device_type}</div>
              </div>
            ))}
            {(!stats?.recentScans || stats.recentScans.length === 0) && (
              <p className="text-sm text-gray-400 text-center py-8">尚無掃瞄記錄</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
