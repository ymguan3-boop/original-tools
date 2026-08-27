import { useEffect, useState } from 'react';
import { api, QRCode, ScanStats } from '../utils/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { ArrowRight } from 'lucide-react';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function Analytics() {
  const [qrs, setQrs] = useState<QRCode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listQRCodes({ limit: 50 }).then((r) => {
      setQrs(r.items);
      if (r.items.length > 0) setSelected(r.items[0].id);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    api.getScanStats(selected).then(setStats);
  }, [selected]);

  const selectedQR = qrs.find((q) => q.id === selected);
  const scanData = stats?.byDay?.map((d: any) => ({ day: d.day, 掃瞄次數: d.cnt })) || [];
  const deviceData = stats?.byDevice?.map((d: any) => ({
    name: d.device_type === 'mobile' ? '手機' : d.device_type === 'tablet' ? '平板' : '電腦',
    value: d.cnt,
  })) || [];
  const browserData = stats?.byBrowser?.map((d: any) => ({ name: d.browser, value: d.cnt })) || [];
  const osData = stats?.byOs?.map((d: any) => ({ name: d.os, value: d.cnt })) || [];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">數據分析</h1>

      {/* Selector */}
      <div className="flex items-center gap-3 mb-6">
        <label className="text-sm text-gray-600">選擇 QR Code：</label>
        <select value={selected || ''} onChange={(e) => setSelected(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200">
          {qrs.map((q) => <option key={q.id} value={q.id}>{q.title} ({q.short_id})</option>)}
        </select>
      </div>

      {stats && (
        <>
          {/* Summary */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-gray-900">{selectedQR?.title}</h2>
                <p className="text-xs text-gray-400">掃瞄連結: /r/{selectedQR?.short_id}</p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-indigo-600">{stats.total}</div>
                <div className="text-xs text-gray-500">累計掃瞄</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <h3 className="font-medium text-gray-900 mb-4">掃瞄趨勢</h3>
              {scanData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={scanData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5) || ''} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="掃瞄次數" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-gray-400 text-center py-12">尚無資料</p>}
            </div>

            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <h3 className="font-medium text-gray-900 mb-4">裝置分佈</h3>
              {deviceData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={deviceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {deviceData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-gray-400 text-center py-12">尚無資料</p>}
            </div>

            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <h3 className="font-medium text-gray-900 mb-4">瀏覽器</h3>
              {browserData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={browserData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                      {browserData.map((_: any, i: number) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-gray-400 text-center py-12">尚無資料</p>}
            </div>

            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <h3 className="font-medium text-gray-900 mb-4">作業系統</h3>
              {osData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={osData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                      {osData.map((_: any, i: number) => <Cell key={i} fill={COLORS[(i + 4) % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-gray-400 text-center py-12">尚無資料</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
