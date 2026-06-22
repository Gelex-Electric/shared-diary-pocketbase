import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { pb } from '../../lib/pocketbase';
import { DatePicker } from '../ui/DateTimePickers';
import {
  Wallet, Users, RefreshCw, Search, X, Loader2,
  CheckCircle2, AlertCircle, AlertTriangle,
} from 'lucide-react';

/* ============================================================
   Công nợ khách hàng — gộp dữ liệu từ collection `invoice` theo
   (MKHang + EndDate): mỗi nhóm là 1 kỳ chốt chỉ số của 1 khách
   hàng (có thể gồm nhiều công tơ). Cho phép xem/sửa "Ngày thanh
   toán" (trường NTToan, lưu đồng nhất cho mọi bản ghi trong nhóm).
   Chỉ dành cho khối Kinh doanh.
============================================================ */

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface DebtInvoiceRecord {
  id: string;
  MKHang: string;
  NMua: string;
  EndDate: string;
  NTToan?: string;
  LoaiHD?: string;
  HSN?: number;
  [key: string]: any; // BT_dau/cuoi..., phu_BT..., DGia_BT..., ThTien_HC/PK
}

interface DebtGroup {
  key: string;
  mkh: string;
  nMua: string;
  endDate: string;
  ids: string[];
  tongSL: number;
  doanhThu: number;
  nTToan: string; // '' nếu chưa thanh toán đồng nhất ở mọi công tơ trong nhóm
}

const num = (v: any) => {
  const n = parseFloat((v ?? '').toString().replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number, d = 0) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(n);

const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];

const fmtDate = (s?: string) => {
  const datePart = dateOnly(s);
  if (!datePart) return '—';
  const [y, m, d] = datePart.split('-');
  return d && m && y ? `${d}/${m}/${y}` : datePart;
};

const currentYear = () => new Date().getFullYear();

// Sản lượng cuối cùng (active, không cho âm) + doanh thu trước thuế của 1 bản ghi
function computeRecordTotals(r: DebtInvoiceRecord) {
  const hsn = num(r.HSN);
  const cuoi = (k: string) =>
    Math.max(0, (num(r[`${k}_cuoi`]) - num(r[`${k}_dau`])) * hsn - num(r[`phu_${k}`])) || 0;
  const tongSL = cuoi('BT') + cuoi('CD') + cuoi('TD');
  const doanhThu = r.LoaiHD === 'VC'
    ? num(r.ThTien_HC) + num(r.ThTien_PK)
    : cuoi('BT') * num(r.DGia_BT) + cuoi('CD') * num(r.DGia_CD) + cuoi('TD') * num(r.DGia_TD);
  return { tongSL, doanhThu };
}

export default function CustomerDebtManager() {
  const [records, setRecords] = useState<DebtInvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState<number | 'all'>(currentYear());
  const [search, setSearch] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const showToast = useCallback((message: string, t: ToastType = 'info') => {
    setToast({ message, type: t });
    setTimeout(() => setToast(null), 4000);
  }, []);

  /* ── load: chỉ tải theo năm đang xem (server-side filter trên EndDate) ── */
  const loadRecords = useCallback(async (y: number | 'all') => {
    setLoading(true);
    try {
      const filter = y === 'all'
        ? ''
        : pb.filter('EndDate >= {:start} && EndDate <= {:end}', {
            start: `${y}-01-01`,
            end: `${y}-12-31`,
          });
      const list = await pb.collection('invoice').getFullList<DebtInvoiceRecord>({
        filter,
        sort: '-EndDate',
        requestKey: null,
      });
      setRecords(list);
    } catch (err: any) {
      showToast(`Lỗi tải dữ liệu: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadRecords(year); }, [loadRecords, year]);

  /* ── gộp theo (MKHang + EndDate) ── */
  const groups = useMemo<DebtGroup[]>(() => {
    const map = new Map<string, DebtGroup>();
    const ntByKey = new Map<string, string[]>();

    records.forEach(r => {
      const mkh = (r.MKHang || '').trim();
      const end = dateOnly(r.EndDate);
      if (!mkh || !end) return;
      const key = `${mkh}|${end}`;
      const { tongSL, doanhThu } = computeRecordTotals(r);

      let g = map.get(key);
      if (!g) {
        g = { key, mkh, nMua: r.NMua || '', endDate: end, ids: [], tongSL: 0, doanhThu: 0, nTToan: '' };
        map.set(key, g);
      }
      g.ids.push(r.id);
      g.tongSL += tongSL;
      g.doanhThu += doanhThu;

      if (!ntByKey.has(key)) ntByKey.set(key, []);
      ntByKey.get(key)!.push(dateOnly(r.NTToan));
    });

    // Chỉ coi là "đã thanh toán" khi MỌI công tơ trong nhóm đều có NTToan
    map.forEach(g => {
      const list = ntByKey.get(g.key) || [];
      const allSet = list.length > 0 && list.every(v => !!v);
      g.nTToan = allSet ? (list[0] || '') : '';
    });

    const q = search.trim().toLowerCase();
    const arr = Array.from(map.values());
    const filtered = q
      ? arr.filter(g => g.mkh.toLowerCase().includes(q) || g.nMua.toLowerCase().includes(q))
      : arr;
    return filtered.sort((a, b) => b.endDate.localeCompare(a.endDate) || a.mkh.localeCompare(b.mkh, 'vi'));
  }, [records, search]);

  const totals = useMemo(() => ({
    tongSL: groups.reduce((s, g) => s + g.tongSL, 0),
    doanhThu: groups.reduce((s, g) => s + g.doanhThu, 0),
    unpaidCount: groups.filter(g => !g.nTToan).length,
  }), [groups]);

  const setPaymentDate = async (g: DebtGroup, date: string) => {
    setSavingKey(g.key);
    try {
      await Promise.all(
        g.ids.map(id => pb.collection('invoice').update(id, { NTToan: date || null })),
      );
      await loadRecords(year);
      showToast(date ? 'Đã lưu ngày thanh toán' : 'Đã đánh dấu chưa thanh toán', 'success');
    } catch (err: any) {
      showToast(`Lỗi khi lưu: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const yearOptions = useMemo(() => {
    const cur = currentYear();
    const arr: number[] = [];
    for (let y = cur; y >= cur - 5; y--) arr.push(y);
    return arr;
  }, []);

  return (
    <div className="space-y-6 pb-12 animate-fade-in relative">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-[300] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white
          ${toast.type === 'success' ? 'bg-emerald-500' : toast.type === 'error' ? 'bg-red-500' : toast.type === 'warning' ? 'bg-amber-500' : 'bg-[#5a8dee]'}`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="vl-card p-5 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[#e8f3ff] rounded-xl text-[#5a8dee] shrink-0">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Công nợ khách hàng</h3>
            <p className="text-[12px] text-slate-400 font-medium">
              Tổng sản lượng &amp; doanh thu theo từng kỳ chốt chỉ số của khách hàng — theo dõi thanh toán
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={year}
            onChange={e => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#5a8dee]"
          >
            {yearOptions.map(y => <option key={y} value={y}>Năm {y}</option>)}
            <option value="all">Tất cả các năm</option>
          </select>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm MKH / tên khách hàng..."
              className="pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium w-56 focus:outline-none focus:ring-2 focus:ring-[#5a8dee]"
            />
          </div>

          <button
            onClick={() => loadRecords(year)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Tải lại
          </button>
        </div>
      </div>

      {/* Tổng hợp nhanh */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="vl-card p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Số kỳ công nợ</p>
          <p className="text-2xl font-extrabold text-slate-800 mt-1">{fmt(groups.length)}</p>
        </div>
        <div className="vl-card p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Tổng sản lượng (kWh)</p>
          <p className="text-2xl font-extrabold text-amber-600 mt-1">{fmt(totals.tongSL)}</p>
        </div>
        <div className="vl-card p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Doanh thu (đ) / Chưa thanh toán</p>
          <p className="text-2xl font-extrabold text-[#5a8dee] mt-1">
            {fmt(totals.doanhThu)}
            {totals.unpaidCount > 0 && (
              <span className="ml-2 text-sm font-bold text-red-500 align-middle">({totals.unpaidCount} chưa TT)</span>
            )}
          </p>
        </div>
      </div>

      {/* Bảng */}
      <div className="vl-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">
                <th className="py-3 px-4">MKH</th>
                <th className="py-3 px-4">Khách hàng</th>
                <th className="py-3 px-4">Ngày chốt chỉ số</th>
                <th className="py-3 px-4 text-right">Tổng sản lượng (kWh)</th>
                <th className="py-3 px-4 text-right">Doanh thu (đ)</th>
                <th className="py-3 px-4 w-[220px]">Ngày thanh toán</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-sm font-semibold">
                  <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Đang tải dữ liệu...
                </td></tr>
              ) : groups.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-sm font-semibold">
                  Không có dữ liệu công nợ trong khoảng đã chọn.
                </td></tr>
              ) : groups.map(g => {
                const unpaid = !g.nTToan;
                const isSaving = savingKey === g.key;
                return (
                  <tr
                    key={g.key}
                    className={`text-slate-700 text-sm transition-colors ${unpaid ? 'bg-red-50/70 hover:bg-red-50' : 'hover:bg-slate-50/80'}`}
                  >
                    <td className="py-3.5 px-4 font-mono font-bold text-[#5a8dee]">{g.mkh || '—'}</td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-slate-300 shrink-0" />
                        <span className="font-semibold truncate max-w-[220px]">{g.nMua || '(Chưa có tên)'}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-semibold text-slate-500">{fmtDate(g.endDate)}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-600">{fmt(g.tongSL)}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-700">{fmt(g.doanhThu)}</td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <DatePicker
                          value={g.nTToan}
                          onChange={val => setPaymentDate(g, val)}
                          className="w-[150px]"
                        />
                        {isSaving && <Loader2 className="w-4 h-4 text-[#5a8dee] animate-spin shrink-0" />}
                        {!isSaving && g.nTToan && (
                          <button
                            onClick={() => setPaymentDate(g, '')}
                            title="Bỏ đánh dấu đã thanh toán"
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!isSaving && unpaid && (
                          <span title="Chưa thanh toán" className="text-red-500 shrink-0">
                            <AlertTriangle className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
