const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export interface QRCode {
  id: string;
  short_id: string;
  title: string;
  link_type: string;
  target: string;
  content_data: string | null;
  folder_id: string | null;
  appearance: string;
  status: string;
  created_at: string;
  updated_at: string;
  scan_count?: number;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  created_at: string;
  qrcode_count?: number;
}

export interface ScanStats {
  total: number;
  byDevice: { device_type: string; cnt: number }[];
  byBrowser: { browser: string; cnt: number }[];
  byOs: { os: string; cnt: number }[];
  byDay: { day: string; cnt: number }[];
}

export interface DashboardStats {
  totalQR: number;
  totalScans: number;
  activeQR: number;
  recentScans: any[];
  scansByDay: { day: string; cnt: number }[];
}

export interface QRListResult {
  items: QRCode[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const api = {
  // QR Codes
  listQRCodes: (params?: { folderId?: string; search?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.folderId) qs.set('folderId', params.folderId);
    if (params?.search) qs.set('search', params.search);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    return request<QRListResult>(`/qrcodes?${qs}`);
  },
  getQRCode: (id: string) => request<QRCode>(`/qrcodes/${id}`),
  createQRCode: (data: any) => request<QRCode>('/qrcodes', { method: 'POST', body: JSON.stringify(data) }),
  updateQRCode: (id: string, data: any) => request<QRCode>(`/qrcodes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteQRCode: (id: string) => request<{ success: boolean }>(`/qrcodes/${id}`, { method: 'DELETE' }),
  getQRImageUrl: (id: string, bust?: string | number) => `${BASE}/qrcodes/${id}/image${bust !== undefined ? `?t=${bust}` : ''}`,

  // Folders
  listFolders: () => request<Folder[]>('/folders'),
  createFolder: (name: string, color?: string) => request<Folder>('/folders', { method: 'POST', body: JSON.stringify({ name, color }) }),
  updateFolder: (id: string, data: any) => request<Folder>(`/folders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFolder: (id: string) => request<{ success: boolean }>(`/folders/${id}`, { method: 'DELETE' }),

  // Analytics
  getScanStats: (id: string) => request<ScanStats>(`/qrcodes/${id}/stats`),
  getDashboardStats: () => request<DashboardStats>('/dashboard/stats'),

  // Upload
  uploadFile: async (file: File): Promise<{ url: string; filename: string }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
};
