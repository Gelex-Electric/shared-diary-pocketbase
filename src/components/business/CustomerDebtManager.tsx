import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { pb } from '../../lib/pocketbase';
import { DatePicker, MonthPicker } from '../ui/DateTimePickers';
import { createNotification } from '../ui/NotificationBell';
import {
  Wallet, Zap, DollarSign, UserX, CheckCircle2, XCircle, AlertCircle,
  Search, ChevronRight, ChevronDown, FileSpreadsheet, Building2,
  RefreshCw, X, Loader2, Save,
} from 'lucide-react';

/* ============================================================
   Công nợ khách hàng — gộp dữ liệu từ collection `invoice`:
   - Tách thành nhiều bảng theo Khu công nghiệp (suy từ tiền tố MKHang).
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
  SHDon?: string;
  NTToan?: string;
  LoaiHD?: string;
  HSN?: number;
  [key: string]: any; // BT_dau/cuoi..., phu_BT..., SL_BT..., ThTien_HC/PK
}

interface KyGroup {
  key: string;       // mkh|S:SHDon (hoặc mkh|endDate nếu thiếu SHDon)
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

interface ZoneGroup {
  code: string;
  name: string;
  customers: CustomerGroup[];
  tongSL: number;
  doanhThu: number;
  unpaidCount: number;
}

/* Khu công nghiệp suy từ tiền tố MKHang (vd "KCNTH-002" → "KCNTH"). */
const ZONE_MAP: Record<string, string> = {
  KCNTH: 'KCN Tiền Hải',
  KCNPĐ: 'KCN Phong Điền',
  KCNTTI: 'KCN Thuận Thành I',
  KCNYM: 'KCN Yên Mỹ',
  KCN03: 'KCN Số 3',
};
const ZONE_ORDER = Object.keys(ZONE_MAP);
// Màu header chung cho mọi bảng KCN
const ZONE_HEADER_GRADIENT = 'from-[#5a8dee] to-[#4880e8]';
const zoneOf = (mkh: string) => (mkh.split('-')[0] || '').trim();

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

// Tổng sản lượng & doanh thu của 1 bản ghi — đọc TRỰC TIẾP từ trường đã lưu
// (TongSL_HC/ThTien_HC nạp thẳng từ XML), không suy từ chỉ số × đơn giá nữa.
// Doanh thu = thành tiền hữu công + thành tiền phản kháng (VC: hữu công = 0).
function computeRecordTotals(r: DebtInvoiceRecord) {
  const tongSL = num(r.TongSL_HC);
  const doanhThu = num(r.ThTien_HC) + num(r.ThTien_PK);
  return { tongSL, doanhThu };
}

export default function CustomerDebtManager() {
  const [records, setRecords] = useState<DebtInvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [monthFilter, setMonthFilter] = useState<string>(currentYearMonth());
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  // Thay đổi ngày thanh toán đang soạn (chưa lưu): key kỳ → ngày ('' = chưa thanh toán)
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
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
        // Cận trên: đầu tháng kế tiếp (loại trừ) — PocketBase lưu date dạng chuỗi
        // "YYYY-MM-DD 00:00:00.000Z", "<= ngày-cuối-tháng" sẽ bỏ sót bản ghi chốt
        // đúng ngày cuối tháng. Dùng "< đầu-tháng-sau" để bao trọn cả ngày cuối.
        const nextStart = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
        filter = pb.filter('EndDate >= {:start} && EndDate < {:nextStart}', { start, nextStart });
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
      // Gộp theo HÓA ĐƠN (SHDon): hóa đơn đổi giá tách 1 công tơ thành nhiều khoảng
      // ngày (nhiều EndDate) nhưng vẫn là MỘT hóa đơn → một kỳ chốt, một lần thanh toán.
      // Bản ghi cũ chưa có SHDon thì fallback về (MKHang + EndDate).
      const shdon = (r.SHDon || '').trim();
      const key = shdon ? `${mkh}|S:${shdon}` : `${mkh}|${end}`;
      const { tongSL, doanhThu } = computeRecordTotals(r);

      let g = kyMap.get(key);
      if (!g) {
        g = { key, mkh, nMua: r.NMua || '', endDate: end, ids: [], tongSL: 0, doanhThu: 0, nTToan: '' };
        kyMap.set(key, g);
      }
      g.ids.push(r.id);
      g.tongSL += tongSL;
      g.doanhThu += doanhThu;
      // Ngày chốt hiển thị = EndDate muộn nhất trong hóa đơn (bỏ qua ranh giới đổi giá)
      if (end > g.endDate) g.endDate = end;

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

  /* ── tra cứu kỳ theo key (ids + ngày gốc) phục vụ lưu thay đổi ── */
  const kyIndex = useMemo(() => {
    const m = new Map<string, { ids: string[]; endDate: string; mkh: string; nMua: string; original: string }>();
    customers.forEach(c => c.kyList.forEach(ky => {
      m.set(ky.key, { ids: ky.ids, endDate: ky.endDate, mkh: c.mkh, nMua: c.nMua, original: ky.nTToan });
    }));
    return m;
  }, [customers]);

  /* ── áp các thay đổi đang soạn (pending) lên dữ liệu để hiển thị tức thì
        nhưng CHƯA lưu vào collection ── */
  const effectiveCustomers = useMemo<CustomerGroup[]>(() => {
    return customers.map(c => {
      let unpaidCount = 0;
      const kyList = c.kyList.map(ky => {
        const nTToan = ky.key in pending ? pending[ky.key] : ky.nTToan;
        if (!nTToan) unpaidCount += 1;
        return { ...ky, nTToan };
      });
      return { ...c, kyList, unpaidCount, isPaid: unpaidCount === 0 };
    });
  }, [customers, pending]);

  /* ── số thay đổi thực sự (khác giá trị gốc) đang chờ lưu ── */
  const pendingCount = useMemo(
    () => Object.entries(pending).filter(([key, date]) => {
      const info = kyIndex.get(key);
      return info && (date || '') !== (info.original || '');
    }).length,
    [pending, kyIndex],
  );

  /* ── KPI tổng quan (theo phạm vi tháng đang chọn, không phụ thuộc tìm kiếm/lọc) ── */
  const kpis = useMemo(() => ({
    unpaidCustomers: effectiveCustomers.filter(c => !c.isPaid).length,
    tongSL: effectiveCustomers.reduce((s, c) => s + c.tongSL, 0),
    doanhThu: effectiveCustomers.reduce((s, c) => s + c.doanhThu, 0),
  }), [effectiveCustomers]);

  /* ── lọc theo tìm kiếm + trạng thái thanh toán ── */
  const displayCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return effectiveCustomers.filter(c => {
      const matchesSearch = !q || c.mkh.toLowerCase().includes(q) || c.nMua.toLowerCase().includes(q);
      const matchesPayment = paymentFilter === 'all' ? true : paymentFilter === 'paid' ? c.isPaid : !c.isPaid;
      return matchesSearch && matchesPayment;
    });
  }, [effectiveCustomers, search, paymentFilter]);

  /* ── tách theo Khu công nghiệp ── */
  const zoneGroups = useMemo<ZoneGroup[]>(() => {
    const map = new Map<string, ZoneGroup>();
    displayCustomers.forEach(c => {
      const code = zoneOf(c.mkh);
      let z = map.get(code);
      if (!z) {
        z = { code, name: ZONE_MAP[code] || code || 'Khác', customers: [], tongSL: 0, doanhThu: 0, unpaidCount: 0 };
        map.set(code, z);
      }
      z.customers.push(c);
      z.tongSL += c.tongSL;
      z.doanhThu += c.doanhThu;
      if (!c.isPaid) z.unpaidCount += 1;
    });
    return Array.from(map.values()).sort((a, b) => {
      const ia = ZONE_ORDER.indexOf(a.code);
      const ib = ZONE_ORDER.indexOf(b.code);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.name.localeCompare(b.name, 'vi');
    });
  }, [displayCustomers]);

  const toggleGroupExpansion = (mkh: string) =>
    setExpandedGroups(prev => ({ ...prev, [mkh]: !prev[mkh] }));

  /* Soạn thay đổi (chưa lưu) — chỉ cập nhật state pending */
  const stagePaymentDate = (key: string, date: string) =>
    setPending(prev => ({ ...prev, [key]: date }));

  const discardChanges = () => setPending({});

  /* Lưu tất cả thay đổi đang soạn vào collection */
  const saveChanges = async () => {
    const entries = Object.entries(pending).filter(([key, date]) => {
      const info = kyIndex.get(key);
      return info && (date || '') !== (info.original || '');
    });
    if (entries.length === 0) { setPending({}); return; }
    setSaving(true);
    try {
      for (const [key, date] of entries) {
        const info = kyIndex.get(key)!;
        await Promise.all(info.ids.map(id => pb.collection('invoice').update(id, { NTToan: date || null })));
        // Chuyển từ "chưa thanh toán" → "đã thanh toán": báo cho khối Vận hành của KCN
        if (date && !info.original) {
          const kcnArea = ZONE_MAP[zoneOf(info.mkh)];
          if (kcnArea) {
            await createNotification({
              title: 'Khách hàng đã thanh toán',
              message: `${info.nMua || info.mkh} (MKH ${info.mkh}) đã thanh toán kỳ ${fmtDate(info.endDate)}.`,
              type: 'payment',
              mkh: info.mkh,
              area: kcnArea,
            });
          }
        }
      }
      await loadRecords(monthFilter);
      setPending({});
      showToast(`Đã lưu ${entries.length} thay đổi thanh toán`, 'success');
    } catch (err: any) {
      showToast(`Lỗi khi lưu: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  /* ── render các dòng của 1 khách hàng (dòng chính + các kỳ mở rộng) ── */
  const renderCustomerRows = (c: CustomerGroup) => {
    const isExpanded = !!expandedGroups[c.mkh];
    const latestKy = c.kyList[0];
    return (
      <React.Fragment key={c.mkh}>
        <tr
          onClick={() => toggleGroupExpansion(c.mkh)}
          className={`transition-colors text-sm cursor-pointer ${
            c.isPaid
              ? 'bg-emerald-50/40 border-l-4 border-l-emerald-400 text-slate-700 hover:bg-emerald-50/80'
              : 'bg-rose-50/70 border-l-4 border-l-rose-500 text-rose-950 font-semibold hover:bg-rose-100/50'
          }`}
        >
          <td className="py-3.5 px-4 font-mono font-bold text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#5a8dee] shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className="truncate">{c.mkh}</span>
            </div>
          </td>
          <td className="py-3.5 px-4 font-semibold text-slate-800 whitespace-normal break-words leading-snug">
            <div className="flex flex-col">
              <span>{c.nMua || '(Chưa có tên)'}</span>
              <span className="text-[10px] font-bold text-[#5a8dee] mt-1 uppercase tracking-wider bg-[#e8f3ff]/70 px-1.5 py-0.5 rounded-md w-fit">
                {c.kyList.length} kỳ
              </span>
            </div>
          </td>
          <td className="py-3.5 px-4 text-center font-mono text-xs text-slate-500">
            <div>{fmtDate(latestKy?.endDate)}</div>
            <div className="text-[9px] font-bold text-amber-600/80 mt-0.5 uppercase tracking-wide font-sans">(Mới nhất)</div>
          </td>
          <td className="py-3.5 px-4 text-center font-mono text-xs">
            {latestKy?.nTToan ? (
              <span className="text-emerald-600 font-bold">{fmtDate(latestKy.nTToan)}</span>
            ) : (
              <span className="text-rose-500/80 font-semibold text-[11px] bg-rose-50/40 px-1.5 py-0.5 rounded border border-rose-100/50">Chưa xong</span>
            )}
          </td>
          <td className="py-3.5 px-4 text-right font-mono font-bold text-xs text-amber-600">
            {fmtKWh(c.tongSL)}
          </td>
          <td className="py-3.5 px-4 text-right font-mono text-slate-800 font-bold text-xs">
            {fmtVND(c.doanhThu)}
          </td>
          <td className="py-3.5 px-4 text-center">
            {c.isPaid ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Đã thanh toán
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md bg-rose-100 text-rose-700">
                <XCircle className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                Còn nợ ({c.unpaidCount} kỳ)
              </span>
            )}
          </td>
        </tr>

        {/* Dòng con mở rộng — mỗi dòng = 1 kỳ chốt chỉ số */}
        {isExpanded && c.kyList.map(ky => {
          const original = kyIndex.get(ky.key)?.original ?? '';
          const isStaged = (ky.key in pending) && ((pending[ky.key] || '') !== (original || ''));
          return (
            <tr
              key={ky.key}
              className={`transition-colors text-xs border-l-[3px] ${
                ky.nTToan
                  ? 'bg-emerald-50/30 border-l-emerald-300 hover:bg-emerald-50/60'
                  : 'bg-rose-50/30 border-l-rose-300 hover:bg-rose-50/60'
              }`}
              onClick={e => e.stopPropagation()}
            >
              <td className="py-3 px-4 font-mono font-bold text-slate-400 pl-8">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ky.nTToan ? 'bg-emerald-400' : 'bg-rose-400'}`} />
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
                    onChange={val => stagePaymentDate(ky.key, val)}
                    className="w-[140px]"
                    usePortal
                  />
                  {ky.nTToan && (
                    <button
                      onClick={() => stagePaymentDate(ky.key, '')}
                      title="Đánh dấu chưa thanh toán"
                      className="p-1 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  {isStaged && (
                    <span title="Chưa lưu" className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
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
                  <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-700">
                    Đã xong
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-700 animate-pulse">
                    Còn nợ
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </React.Fragment>
    );
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
            Tổng hợp sản lượng &amp; doanh thu theo từng kỳ chốt chỉ số của khách hàng, tách theo khu công nghiệp.
          </p>
        </div>

        {/* Bộ chọn tháng + tìm kiếm (bên phải) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 md:shrink-0">
          <MonthPicker
            value={monthFilter}
            onChange={v => { setPending({}); setMonthFilter(v); }}
            allowAll
            className="min-w-[170px]"
          />
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm MKH, tên công ty..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-slate-200 bg-white rounded-lg text-slate-700 text-sm focus:outline-none focus:ring-1 focus:ring-[#5a8dee] w-full sm:w-[240px]"
            />
          </div>
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

      {/* Thanh điều khiển: tải lại + lọc trạng thái + chú thích màu */}
      <div className="vl-card p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-[11px] font-semibold text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-100 border-l-4 border-l-emerald-400 shrink-0" /> Đã thanh toán
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-100 border-l-4 border-l-rose-500 shrink-0" /> Còn nợ
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Lưu thay đổi (chỉ lưu khi bấm nút này) */}
          <button
            onClick={saveChanges}
            disabled={saving || pendingCount === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold text-white bg-[#5a8dee] hover:bg-[#4a7de2] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Đang lưu...' : `Lưu thay đổi${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
          </button>

          {pendingCount > 0 && !saving && (
            <button
              onClick={discardChanges}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Hủy
            </button>
          )}

          <button
            onClick={() => { setPending({}); loadRecords(monthFilter); }}
            disabled={loading || saving}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Tải lại
          </button>

          {/* Status Filter Tab */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200">
            <button
              onClick={() => setPaymentFilter('all')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${paymentFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              Tất cả
            </button>
            <button
              onClick={() => setPaymentFilter('paid')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 ${paymentFilter === 'paid' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-emerald-600'}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" /> Đã xong
            </button>
            <button
              onClick={() => setPaymentFilter('unpaid')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 ${paymentFilter === 'unpaid' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-rose-600'}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" /> Còn nợ
            </button>
          </div>
        </div>
      </div>

      {/* Loading / Empty */}
      {loading ? (
        <div className="vl-card p-16 text-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" /> Đang tải dữ liệu...
        </div>
      ) : zoneGroups.length === 0 ? (
        <div className="vl-card p-16 text-center text-slate-400">
          <div className="flex flex-col items-center justify-center">
            <FileSpreadsheet className="w-12 h-12 text-slate-200 mb-3" />
            <p className="text-sm">Không tìm thấy khách hàng nào khớp bộ lọc</p>
          </div>
        </div>
      ) : (
        /* ── Mỗi Khu công nghiệp một bảng ── */
        zoneGroups.map(zone => (
          <div key={zone.code} className="vl-card overflow-hidden scroll-mt-6">
            {/* Zone header — màu chung cho mọi KCN */}
            <div className={`bg-gradient-to-r ${ZONE_HEADER_GRADIENT} px-5 md:px-7 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3`}>
              <div className="flex items-center gap-3 text-white">
                <div className="p-2 bg-white/20 rounded-xl shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black tracking-tight leading-tight">{zone.name}</h3>
                  <p className="text-[11px] font-semibold text-white/80">{zone.customers.length} khách hàng</p>
                </div>
              </div>

              {zone.unpaidCount > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-black shadow-sm flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> {zone.unpaidCount} còn nợ
                </span>
              )}
            </div>

            {/* Zone table */}
            <div className="overflow-x-auto">
              <table className="vl-table w-full text-left border-collapse table-fixed min-w-[850px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">
                    <th className="py-3.5 px-4 w-[130px]">Mã khách hàng</th>
                    <th className="py-3.5 px-4 w-[28%]">Tên doanh nghiệp</th>
                    <th className="py-3.5 px-4 w-[14%] text-center">Ngày chốt chỉ số</th>
                    <th className="py-3.5 px-4 w-[18%] text-center">Ngày thanh toán</th>
                    <th className="py-3.5 px-4 w-[12%] text-right">Sản lượng điện</th>
                    <th className="py-3.5 px-4 w-[14%] text-right">Số tiền hóa đơn</th>
                    <th className="py-3.5 px-4 text-center w-[14%]">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {zone.customers.map(renderCustomerRows)}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t-2 border-slate-200 text-sm font-black">
                    <td colSpan={4} className="py-3.5 px-4 text-right text-slate-600 uppercase text-xs tracking-wider">
                      Tổng cộng {zone.name}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-amber-600">{fmtKWh(zone.tongSL)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-[#5a8dee]">{fmtVND(zone.doanhThu)}</td>
                    <td className="py-3.5 px-4" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
