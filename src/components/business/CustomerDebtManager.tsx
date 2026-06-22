import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { pb } from '../../lib/pocketbase';
import { DatePicker, MonthPicker } from '../ui/DateTimePickers';
import {
  Wallet, Zap, DollarSign, UserX, CheckCircle2, XCircle, AlertCircle,
  Search, ChevronLeft, ChevronRight, ChevronDown, FileSpreadsheet,
  RefreshCw, X, Loader2,
} from 'lucide-react';

/* ============================================================
   Công nợ khách hàng — gộp dữ liệu từ collection `invoice`:
   - Cấp 1: theo MKHang (khách hàng) — tổng hợp toàn bộ kỳ.
   - Cấp 2 (mở rộng): theo (MKHang + EndDate) — mỗi kỳ chốt chỉ số
     (có thể gồm nhiều công tơ cùng ngày EndDate).
   "Ngày thanh toán" (trường NTToan) ghi đồng nhất cho mọi bản ghi
   trong 1 kỳ. Chỉ dành cho khối Kinh doanh.
============================================================ */

type ToastType = 'success' | 'error' | 'warning' | 'info';
type PaymentFilter = 'all' | 'paid' | 'unpaid';

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

interface KyGroup {
  key: string;       // mkh|endDate
  endDate: string;
  ids: string[];
  tongSL: number;
  doanhThu: number;
  nTToan: string;     // '' nếu chưa thanh toán đồng nhất ở mọi công tơ trong kỳ
}

interface CustomerGroup {
  mkh: string;
  nMua: string;
  kyList: KyGroup[];   // sắp xếp giảm dần theo EndDate
  tongSL: number;
  doanhThu: number;
  isPaid: boolean;
  unpaidCount: number;
}

const num = (v: any) => {
  const n = parseFloat((v ?? '').toString().replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const fmtKWh = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n);
const fmtVND = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n);

const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];

const fmtDate = (s?: string) => {
  const datePart = dateOnly(s);
  if (!datePart) return '—';
  const [y, m, d] = datePart.split('-');
  return d && m && y ? `${d}/${m}/${y}` : datePart;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const currentYearMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

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

const ITEMS_PER_PAGE = 8;

export default function CustomerDebtManager() {
  const [records, setRecords] = useState<DebtInvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [monthFilter, setMonthFilter] = useState<string>(currentYearMonth());
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const showToast = useCallback((message: string, t: ToastType = 'info') => {
    setToast({ message, type: t });
    setTimeout(() => setToast(null), 4000);
  }, []);

  /* ── load: chỉ tải theo tháng đang xem (server-side filter trên EndDate) ── */
  const loadRecords = useCallback(async (ym: string) => {
    setLoading(true);
    try {
      let filter = '';
      if (ym && ym !== 'all') {
        const [y, m] = ym.split('-').map(Number);
        const start = `${ym}-01`;
        const end = `${ym}-${pad2(new Date(y, m, 0).getDate())}`;
        filter = pb.filter('EndDate >= {:start} && EndDate <= {:end}', { start, end });
      }
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

  useEffect(() => { loadRecords(monthFilter); }, [loadRecords, monthFilter]);

  /* ── gộp cấp 1: theo MKHang ; cấp 2: theo (MKHang + EndDate) ── */
  const customers = useMemo<CustomerGroup[]>(() => {
    const kyMap = new Map<string, KyGroup & { mkh: string; nMua: string }>();
    const ntByKey = new Map<string, string[]>();

    records.forEach(r => {
      const mkh = (r.MKHang || '').trim();
      const end = dateOnly(r.EndDate);
      if (!mkh || !end) return;
      const key = `${mkh}|${end}`;
      const { tongSL, doanhThu } = computeRecordTotals(r);

      let g = kyMap.get(key);
      if (!g) {
        g = { key, mkh, nMua: r.NMua || '', endDate: end, ids: [], tongSL: 0, doanhThu: 0, nTToan: '' };
        kyMap.set(key, g);
      }
      g.ids.push(r.id);
      g.tongSL += tongSL;
      g.doanhThu += doanhThu;

      if (!ntByKey.has(key)) ntByKey.set(key, []);
      ntByKey.get(key)!.push(dateOnly(r.NTToan));
    });

    // Chỉ coi là "đã thanh toán" khi MỌI công tơ trong kỳ đều có NTToan
    kyMap.forEach(g => {
      const list = ntByKey.get(g.key) || [];
      const allSet = list.length > 0 && list.every(v => !!v);
      g.nTToan = allSet ? (list[0] || '') : '';
    });

    const custMap = new Map<string, CustomerGroup>();
    kyMap.forEach(g => {
      let c = custMap.get(g.mkh);
      if (!c) {
        c = { mkh: g.mkh, nMua: g.nMua, kyList: [], tongSL: 0, doanhThu: 0, isPaid: true, unpaidCount: 0 };
        custMap.set(g.mkh, c);
      }
      c.kyList.push(g);
      c.tongSL += g.tongSL;
      c.doanhThu += g.doanhThu;
      if (!g.nTToan) { c.isPaid = false; c.unpaidCount += 1; }
    });
    custMap.forEach(c => c.kyList.sort((a, b) => b.endDate.localeCompare(a.endDate)));

    return Array.from(custMap.values()).sort((a, b) => a.mkh.localeCompare(b.mkh, 'vi'));
  }, [records]);

  /* ── KPI tổng quan (theo phạm vi tháng đang chọn, không phụ thuộc tìm kiếm/lọc) ── */
  const kpis = useMemo(() => ({
    unpaidCustomers: customers.filter(c => !c.isPaid).length,
    tongSL: customers.reduce((s, c) => s + c.tongSL, 0),
    doanhThu: customers.reduce((s, c) => s + c.doanhThu, 0),
  }), [customers]);

  /* ── lọc theo tìm kiếm + trạng thái thanh toán ── */
  const displayCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter(c => {
      const matchesSearch = !q || c.mkh.toLowerCase().includes(q) || c.nMua.toLowerCase().includes(q);
      const matchesPayment = paymentFilter === 'all' ? true : paymentFilter === 'paid' ? c.isPaid : !c.isPaid;
      return matchesSearch && matchesPayment;
    });
  }, [customers, search, paymentFilter]);

  const totalPages = Math.ceil(displayCustomers.length / ITEMS_PER_PAGE) || 1;
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return displayCustomers.slice(start, start + ITEMS_PER_PAGE);
  }, [displayCustomers, currentPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  const toggleGroupExpansion = (mkh: string) =>
    setExpandedGroups(prev => ({ ...prev, [mkh]: !prev[mkh] }));

  const setPaymentDate = async (g: KyGroup, date: string) => {
    setSavingKey(g.key);
    try {
      await Promise.all(g.ids.map(id => pb.collection('invoice').update(id, { NTToan: date || null })));
      await loadRecords(monthFilter);
      showToast(date ? 'Đã lưu ngày thanh toán' : 'Đã đánh dấu chưa thanh toán', 'success');
    } catch (err: any) {
      showToast(`Lỗi khi lưu: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setSavingKey(null);
    }
  };

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
      <div className="vl-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-[#e8f3ff] rounded-2xl text-[#5a8dee]">
              <Wallet className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Công nợ khách hàng</h1>
          </div>
          <p className="text-sm text-slate-500 max-w-2xl">
            Tổng hợp sản lượng &amp; doanh thu theo từng kỳ chốt chỉ số của khách hàng, đối soát thanh toán.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="vl-card p-6 md:p-7 hover:-translate-y-1 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider">Số khách hàng chưa thanh toán</span>
            <div className="p-2.5 bg-rose-50 rounded-2xl text-rose-500 group-hover:scale-110 transition-transform">
              <UserX className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-slate-800 tracking-tight leading-none font-mono">{fmtKWh(kpis.unpaidCustomers)}</h3>
        </div>

        <div className="vl-card p-6 md:p-7 hover:-translate-y-1 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Tổng sản lượng (kWh)</span>
            <div className="p-2.5 bg-amber-50 rounded-2xl text-amber-500 group-hover:scale-110 transition-transform">
              <Zap className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-slate-800 tracking-tight leading-none font-mono">{fmtKWh(kpis.tongSL)}</h3>
        </div>

        <div className="vl-card p-6 md:p-7 hover:-translate-y-1 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-[#5a8dee] uppercase tracking-wider">Doanh thu (đồng)</span>
            <div className="p-2.5 bg-[#f4f8ff] rounded-2xl text-[#5a8dee] group-hover:scale-110 transition-transform">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-slate-800 tracking-tight leading-none font-mono">{fmtVND(kpis.doanhThu)}</h3>
        </div>
      </div>

      {/* Customer Debt Table */}
      <div id="customer-debt-table" className="vl-card overflow-hidden scroll-mt-6">
        {/* Table Control Header */}
        <div className="p-6 md:p-8 border-b border-slate-150 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-50/50">
          <div>
            <h3 className="text-lg font-black text-slate-800 tracking-tight">Danh sách công nợ khách hàng</h3>
          </div>

          <div className="flex flex-col md:flex-row md:items-center gap-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm MKH, tên công ty..."
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                className="pl-10 pr-4 py-2 border border-slate-200 bg-white rounded text-slate-700 text-sm focus:outline-none focus:ring-1 focus:ring-[#5a8dee] w-full sm:w-[240px]"
              />
            </div>

            {/* Month Filter */}
            <MonthPicker
              value={monthFilter}
              onChange={v => { setMonthFilter(v); setCurrentPage(1); }}
              allowAll
              className="min-w-[170px]"
            />

            <button
              onClick={() => loadRecords(monthFilter)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Tải lại
            </button>

            {/* Status Filter Tab */}
            <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200">
              <button
                onClick={() => { setPaymentFilter('all'); setCurrentPage(1); }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${paymentFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Tất cả
              </button>
              <button
                onClick={() => { setPaymentFilter('paid'); setCurrentPage(1); }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 ${paymentFilter === 'paid' ? 'bg-[#5a8dee] text-white shadow-sm' : 'text-slate-400 hover:text-[#5a8dee]'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> Đã xong
              </button>
              <button
                onClick={() => { setPaymentFilter('unpaid'); setCurrentPage(1); }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 ${paymentFilter === 'unpaid' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-rose-600'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> Còn nợ
              </button>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left border-collapse table-fixed min-w-[850px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-4 px-4 w-[130px]">Mã khách hàng</th>
                <th className="py-4 px-4 w-[28%]">Tên doanh nghiệp</th>
                <th className="py-4 px-4 w-[14%] text-center">Ngày chốt chỉ số</th>
                <th className="py-4 px-4 w-[18%] text-center">Ngày thanh toán</th>
                <th className="py-4 px-4 w-[12%] text-right">Sản lượng điện</th>
                <th className="py-4 px-4 w-[14%] text-right">Số tiền hóa đơn</th>
                <th className="py-4 px-4 text-center w-[14%]">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="py-16 text-center text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" /> Đang tải dữ liệu...
                </td></tr>
              ) : paginatedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <FileSpreadsheet className="w-12 h-12 text-slate-200 mb-3" />
                      <p className="text-sm">Không tìm thấy khách hàng nào khớp bộ lọc</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedCustomers.map(c => {
                const isExpanded = !!expandedGroups[c.mkh];
                const latestKy = c.kyList[0];
                return (
                  <React.Fragment key={c.mkh}>
                    <tr
                      onClick={() => toggleGroupExpansion(c.mkh)}
                      className={`transition-colors text-slate-700 text-sm hover:bg-slate-50/80 cursor-pointer ${
                        !c.isPaid
                          ? 'bg-rose-50/70 border-l-4 border-l-rose-500 text-rose-950 font-semibold md:hover:bg-rose-100/30'
                          : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-4 px-4 font-mono font-bold text-[11px] text-slate-500">
                        <div className="flex items-center gap-1.5">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-[#5a8dee] shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className="truncate">{c.mkh}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 font-semibold text-slate-800 whitespace-normal break-words leading-snug">
                        <div className="flex flex-col">
                          <span className="text-slate-800 hover:text-[#5a8dee] transition-colors">{c.nMua || '(Chưa có tên)'}</span>
                          <span className="text-[10px] font-bold text-[#5a8dee] mt-1 uppercase tracking-wider bg-[#e8f3ff]/70 px-1.5 py-0.5 rounded-md w-fit">
                            {c.kyList.length} kỳ
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center font-mono text-xs text-slate-500">
                        <div>{fmtDate(latestKy?.endDate)}</div>
                        <div className="text-[9px] font-bold text-amber-600/80 mt-0.5 uppercase tracking-wide font-sans">(Mới nhất)</div>
                      </td>
                      <td className="py-4 px-4 text-center font-mono text-xs">
                        {latestKy?.nTToan ? (
                          <span className="text-emerald-600 font-bold">{fmtDate(latestKy.nTToan)}</span>
                        ) : (
                          <span className="text-rose-500/80 font-semibold text-[11px] bg-rose-50/30 px-1.5 py-0.5 rounded border border-rose-100/45">Chưa xong</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right font-mono font-bold text-xs text-amber-600">
                        {fmtKWh(c.tongSL)}
                      </td>
                      <td className="py-4 px-4 text-right font-mono text-slate-800 font-bold text-xs">
                        {fmtVND(c.doanhThu)}
                      </td>
                      <td className="py-4 px-4 text-center">
                        {c.isPaid ? (
                          <span className="vl-badge-success inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Đã thanh toán
                          </span>
                        ) : (
                          <span className="vl-badge-danger inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded">
                            <XCircle className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                            Còn nợ ({c.unpaidCount} kỳ)
                          </span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable child rows — mỗi dòng = 1 kỳ chốt chỉ số */}
                    {isExpanded && c.kyList.map(ky => {
                      const isSaving = savingKey === ky.key;
                      return (
                        <tr
                          key={ky.key}
                          className="bg-slate-50/60 hover:bg-slate-100/60 transition-colors border-l-[3px] border-l-[#5a8dee] text-slate-600 text-xs"
                          onClick={e => e.stopPropagation()}
                        >
                          <td className="py-3 px-4 font-mono font-bold text-slate-400 pl-8">
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#5a8dee] shrink-0" />
                              <span>Kỳ {fmtDate(ky.endDate)}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-500 italic pl-6 whitespace-normal break-words leading-relaxed text-[11px]">
                            {ky.ids.length} công tơ
                          </td>
                          <td className="py-3 px-4 text-center font-mono text-[11px] text-slate-500">
                            {fmtDate(ky.endDate)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <DatePicker
                                value={ky.nTToan}
                                onChange={val => setPaymentDate(ky, val)}
                                className="w-[140px]"
                                usePortal
                              />
                              {isSaving && <Loader2 className="w-3.5 h-3.5 text-[#5a8dee] animate-spin shrink-0" />}
                              {!isSaving && ky.nTToan && (
                                <button
                                  onClick={() => setPaymentDate(ky, '')}
                                  title="Bỏ đánh dấu đã thanh toán"
                                  className="p-1 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-amber-600/80 font-bold text-[11px]">
                            {fmtKWh(ky.tongSL)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-600 font-bold text-[11px]">
                            {fmtVND(ky.doanhThu)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {ky.nTToan ? (
                              <span className="vl-badge-success inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded">
                                Đã xong
                              </span>
                            ) : (
                              <span className="vl-badge-danger inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded animate-pulse">
                                Còn nợ
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination */}
        {displayCustomers.length > 0 && (
          <div className="p-4 md:p-6 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs font-semibold text-slate-500">
            <p>
              Hiển thị <span className="font-bold text-slate-700">{Math.min(displayCustomers.length, (currentPage - 1) * ITEMS_PER_PAGE + 1)}-{Math.min(displayCustomers.length, currentPage * ITEMS_PER_PAGE)}</span> trong tổng số <span className="font-bold text-slate-700">{displayCustomers.length}</span> khách hàng
            </p>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 border border-slate-200 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                aria-label="Trang trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-mono">
                {currentPage} / {totalPages}
              </span>

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-2 border border-slate-200 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                aria-label="Trang sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
