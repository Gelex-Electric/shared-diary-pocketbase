import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  SCT?: string;
  StartDate?: string;
  EndDate: string;
  IndexId?: string;
  BillId?: string;
  NTToan?: string;
  LoaiHD?: string;
  HSN?: number;
  [key: string]: any; // BT_dau/cuoi..., phu_BT..., SL_BT..., ThTien_HC/PK
}

/* Tổng hợp 4 chỉ tiêu: sản lượng hữu công (kWh) / vô công (kVarh) và
   doanh thu hữu công / vô công. */
interface Totals {
  slHC: number;   // sản lượng hữu công (kWh)
  slVC: number;   // sản lượng vô công (kVarh)
  dtHC: number;   // doanh thu hữu công
  dtVC: number;   // doanh thu vô công (phản kháng)
}

interface KyGroup extends Totals {
  key: string;       // MKHang|LoaiHD|B:BillId (hoặc fallback nối ngày MKHang|LoaiHD|SCT|StartDate)
  endDate: string;
  ids: string[];
  nTToan: string;     // '' nếu chưa thanh toán đồng nhất ở mọi công tơ trong kỳ
}

interface CustomerGroup extends Totals {
  mkh: string;
  nMua: string;
  kyList: KyGroup[];   // sắp xếp giảm dần theo EndDate
  isPaid: boolean;
  unpaidCount: number;
}

interface ZoneGroup extends Totals {
  code: string;
  name: string;
  customers: CustomerGroup[];
  unpaidCount: number;
}

const emptyTotals = (): Totals => ({ slHC: 0, slVC: 0, dtHC: 0, dtVC: 0 });
const addTotals = (a: Totals, b: Totals) => {
  a.slHC += b.slHC; a.slVC += b.slVC; a.dtHC += b.dtHC; a.dtVC += b.dtVC;
};

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
const ZONE_HEADER_GRADIENT = 'from-[var(--accent)] to-[var(--accent)]';
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

// Sản lượng & doanh thu của 1 bản ghi — đọc TRỰC TIẾP từ trường đã lưu (nạp thẳng từ XML).
// Hữu công: TongSL_HC (kWh) / ThTien_HC. Vô công (phản kháng): TongSL_PK (kVarh) / ThTien_PK.
function computeRecordTotals(r: DebtInvoiceRecord): Totals {
  return {
    slHC: num(r.TongSL_HC),
    slVC: num(r.TongSL_PK),
    dtHC: num(r.ThTien_HC),
    dtVC: num(r.ThTien_PK),
  };
}

export default function CustomerDebtManager() {
  const [records, setRecords] = useState<DebtInvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [monthFilter, setMonthFilter] = useState<string>(currentYearMonth());
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  // Bảng KCN bị thu gọn (mặc định mở); key = mã KCN
  const [collapsedZones, setCollapsedZones] = useState<Record<string, boolean>>({});
  // Thay đổi ngày thanh toán đang soạn (chưa lưu): key kỳ → ngày ('' = chưa thanh toán)
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null);
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

  /* ── gộp cấp 1: theo MKHang ; cấp 2: HÓA ĐƠN (gộp khoảng đổi giá theo công tơ) ── */
  const customers = useMemo<CustomerGroup[]>(() => {
    const kyMap = new Map<string, KyGroup & { mkh: string; nMua: string }>();
    const ntByKey = new Map<string, string[]>();

    // GỘP THEO HÓA ĐƠN. Ưu tiên BillId (mã hóa đơn, đọc từ XML hoặc SOAP); kế đến IndexId
    // (=MIN MHHDVu của công tơ, luôn có trong XML khi BillId trống). Hóa đơn đổi giá tách 1
    // công tơ thành nhiều khoảng nhưng CHUNG BillId/IndexId → một kỳ, một lần thanh toán.
    // Thiếu cả hai (dữ liệu cũ) → fallback nối chuỗi ngày theo công tơ.
    const upsertKy = (key: string, r: DebtInvoiceRecord) => {
      const end = dateOnly(r.EndDate);
      let g = kyMap.get(key);
      if (!g) {
        g = { key, mkh: (r.MKHang || '').trim(), nMua: r.NMua || '', endDate: end, ids: [], ...emptyTotals(), nTToan: '' };
        kyMap.set(key, g);
        ntByKey.set(key, []);
      }
      g.ids.push(r.id);
      addTotals(g, computeRecordTotals(r));
      if (end > g.endDate) g.endDate = end; // ngày chốt = EndDate muộn nhất
      ntByKey.get(key)!.push(dateOnly(r.NTToan));
    };

    // Tách 2 nhóm: có BillId (gộp thẳng theo BillId) và không có BillId (nối ngày theo công tơ)
    const noBill = new Map<string, DebtInvoiceRecord[]>();
    records.forEach(r => {
      const mkh = (r.MKHang || '').trim();
      const end = dateOnly(r.EndDate);
      if (!mkh || !end) return;
      const loai = (r.LoaiHD || '').trim();
      const billId = (r.BillId ?? '').toString().trim();
      const indexId = (r.IndexId ?? '').toString().trim();
      if (billId && billId !== '0') {
        upsertKy(`${mkh}|${loai}|B:${billId}`, r);
      } else if (indexId && indexId !== '0') {
        upsertKy(`${mkh}|${loai}|I:${indexId}`, r);
      } else {
        const bk = `${mkh}|${loai}|${(r.SCT || '').trim()}`;
        if (!noBill.has(bk)) noBill.set(bk, []);
        noBill.get(bk)!.push(r);
      }
    });

    // Fallback: nối chuỗi ngày liền mạch theo công tơ cho bản ghi thiếu BillId
    noBill.forEach((recs, bk) => {
      recs.sort((a, b) =>
        (dateOnly(a.StartDate) || dateOnly(a.EndDate)).localeCompare(dateOnly(b.StartDate) || dateOnly(b.EndDate)),
      );
      let curKey = '';
      let curLastEnd = '';
      recs.forEach(r => {
        const start = dateOnly(r.StartDate);
        const end = dateOnly(r.EndDate);
        const continues = !!curKey && !!start && !!curLastEnd && start === curLastEnd;
        if (!continues) curKey = `${bk}|${start || end}`;
        upsertKy(curKey, r);
        curLastEnd = end;
      });
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
        c = { mkh: g.mkh, nMua: g.nMua, kyList: [], ...emptyTotals(), isPaid: true, unpaidCount: 0 };
        custMap.set(g.mkh, c);
      }
      c.kyList.push(g);
      addTotals(c, g);
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
    slHC: effectiveCustomers.reduce((s, c) => s + c.slHC, 0),
    slVC: effectiveCustomers.reduce((s, c) => s + c.slVC, 0),
    dtHC: effectiveCustomers.reduce((s, c) => s + c.dtHC, 0),
    dtVC: effectiveCustomers.reduce((s, c) => s + c.dtVC, 0),
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
        z = { code, name: ZONE_MAP[code] || code || 'Khác', customers: [], ...emptyTotals(), unpaidCount: 0 };
        map.set(code, z);
      }
      z.customers.push(c);
      addTotals(z, c);
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
  const toggleZone = (code: string) =>
    setCollapsedZones(prev => ({ ...prev, [code]: !prev[code] }));

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
    setSaveProgress({ done: 0, total: entries.length });
    try {
      for (let i = 0; i < entries.length; i++) {
        const [key, date] = entries[i];
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
        setSaveProgress({ done: i + 1, total: entries.length });
      }
      await loadRecords(monthFilter);
      setPending({});
      showToast(`Đã lưu ${entries.length} thay đổi thanh toán`, 'success');
    } catch (err: any) {
      showToast(`Lỗi khi lưu: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setSaving(false);
      setSaveProgress(null);
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
              ? 'bg-[var(--success-soft)]/40 border-l-4 border-l-emerald-400 text-dim hover:bg-[var(--success-soft)]/80'
              : 'bg-rose-50/70 border-l-4 border-l-rose-500 text-rose-950 font-semibold hover:bg-rose-100/50'
          }`}
        >
          <td className="py-3.5 px-4 font-mono font-bold text-[11px] text-soft">
            <div className="flex items-center gap-1.5">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-accent shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-faint shrink-0" />
              )}
              <span className="whitespace-nowrap">{c.mkh}</span>
            </div>
          </td>
          <td className="py-3.5 px-4 font-semibold text-ink whitespace-normal break-words leading-snug">
            <div className="flex flex-col">
              <span>{c.nMua || '(Chưa có tên)'}</span>
              <span className="text-[10px] font-bold text-accent mt-1 uppercase tracking-wider bg-accent-soft/70 px-1.5 py-0.5 rounded-md w-fit">
                {c.kyList.length} hóa đơn
              </span>
            </div>
          </td>
          <td className="py-3.5 px-4 text-center font-mono text-xs text-soft">
            <div>{fmtDate(latestKy?.endDate)}</div>
          </td>
          <td className="py-3.5 px-4 text-center font-mono text-xs">
            {latestKy?.nTToan ? (
              <span className="text-ok font-bold">{fmtDate(latestKy.nTToan)}</span>
            ) : (
              <span className="text-rose-500/80 font-semibold text-[11px] bg-rose-50/40 px-1.5 py-0.5 rounded border border-rose-100/50">Chưa xong</span>
            )}
          </td>
          <td className="py-3.5 px-4 text-right font-mono text-xs">
            {(c.slHC > 0 || c.slVC === 0) && (
              <div className="font-bold text-warn">{fmtKWh(c.slHC)} <span className="text-[9px] text-warn/60">kWh</span></div>
            )}
            {c.slVC > 0 && (
              <div className="text-[10px] text-faint font-semibold">{fmtKWh(c.slVC)} kVarh</div>
            )}
          </td>
          <td className="py-3.5 px-4 text-right font-mono text-xs">
            <div className="text-ink font-bold">{fmtVND(c.dtHC + c.dtVC)}</div>
          </td>
          <td className="py-3.5 px-4 text-center">
            {c.isPaid ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md bg-emerald-100 text-ok">
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
                  ? 'bg-[var(--success-soft)]/30 border-l-emerald-300 hover:bg-[var(--success-soft)]/60'
                  : 'bg-rose-50/30 border-l-rose-300 hover:bg-rose-50/60'
              }`}
              onClick={e => e.stopPropagation()}
            >
              <td className="py-3 px-4 font-mono font-bold text-faint pl-8">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ky.nTToan ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span>Kỳ {fmtDate(ky.endDate)}</span>
                </div>
              </td>
              <td className="py-3 px-4 text-soft italic pl-6 whitespace-normal break-words leading-relaxed text-[11px]">
                {ky.ids.length} công tơ
              </td>
              <td className="py-3 px-4 text-center font-mono text-[11px] text-soft">
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
                      className="p-1 rounded-lg text-faint hover:bg-[var(--danger-soft)] hover:text-red-500 transition-colors shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  {isStaged && (
                    <span title="Chưa lưu" className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  )}
                </div>
              </td>
              <td className="py-3 px-4 text-right font-mono text-[11px]">
                {(ky.slHC > 0 || ky.slVC === 0) && (
                  <div className="text-warn/80 font-bold">{fmtKWh(ky.slHC)} <span className="text-[9px] text-warn/50">kWh</span></div>
                )}
                {ky.slVC > 0 && (
                  <div className="text-[10px] text-faint font-semibold">{fmtKWh(ky.slVC)} kVarh</div>
                )}
              </td>
              <td className="py-3 px-4 text-right font-mono text-[11px]">
                <div className="text-dim font-bold">{fmtVND(ky.dtHC + ky.dtVC)}</div>
              </td>
              <td className="py-3 px-4 text-center">
                {ky.nTToan ? (
                  <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-ok">
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
          ${toast.type === 'success' ? 'bg-emerald-500' : toast.type === 'error' ? 'bg-red-500' : toast.type === 'warning' ? 'bg-amber-500' : 'bg-accent'}`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="vl-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-accent-soft rounded-2xl text-accent">
              <Wallet className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-ink tracking-tight uppercase">Công nợ khách hàng</h1>
          </div>
          <p className="text-sm text-soft max-w-2xl">
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
            <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm MKH, tên công ty..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-[var(--border)] bg-surface rounded-lg text-dim text-sm focus:outline-none focus:ring-1 focus:ring-accent w-full sm:w-[240px]"
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
          <h3 className="text-2xl font-black text-ink tracking-tight leading-none font-mono">{fmtKWh(kpis.unpaidCustomers)}</h3>
        </div>

        <div className="vl-card p-6 md:p-7 hover:-translate-y-1 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-warn uppercase tracking-wider">Tổng sản lượng</span>
            <div className="p-2.5 bg-[var(--warning-soft)] rounded-2xl text-amber-500 group-hover:scale-110 transition-transform">
              <Zap className="w-5 h-5" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] font-bold text-warn/70 uppercase tracking-wider mb-0.5">Hữu công (kWh)</p>
              <h3 className="text-xl font-black text-ink tracking-tight leading-none font-mono">{fmtKWh(kpis.slHC)}</h3>
            </div>
            <div className="pl-3 border-l border-[var(--border)]">
              <p className="text-[9px] font-bold text-faint uppercase tracking-wider mb-0.5">Vô công (kVarh)</p>
              <h3 className="text-xl font-black text-soft tracking-tight leading-none font-mono">{fmtKWh(kpis.slVC)}</h3>
            </div>
          </div>
        </div>

        <div className="vl-card p-6 md:p-7 hover:-translate-y-1 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Doanh thu (đồng)</span>
            <div className="p-2.5 bg-accent-soft rounded-2xl text-accent group-hover:scale-110 transition-transform">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-ink tracking-tight leading-none font-mono">{fmtVND(kpis.dtHC + kpis.dtVC)}</h3>
        </div>
      </div>

      {/* Thanh điều khiển: tải lại + lọc trạng thái + chú thích màu */}
      <div className="vl-card p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-[11px] font-semibold text-soft">
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
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold text-white bg-accent hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving
              ? `Đang lưu... ${saveProgress ? `${saveProgress.done}/${saveProgress.total}` : ''}`
              : `Lưu thay đổi${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
          </button>

          {pendingCount > 0 && !saving && (
            <button
              onClick={discardChanges}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-[var(--border)] rounded-lg text-sm font-bold text-soft hover:bg-subtle transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Hủy
            </button>
          )}

          <button
            onClick={() => { setPending({}); loadRecords(monthFilter); }}
            disabled={loading || saving}
            className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-[var(--border)] rounded-lg text-sm font-bold text-dim hover:bg-subtle transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Tải lại
          </button>

          {/* Status Filter Tab */}
          <div className="bg-subtle p-1 rounded-xl flex items-center border border-[var(--border)]">
            <button
              onClick={() => setPaymentFilter('all')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${paymentFilter === 'all' ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-dim'}`}
            >
              Tất cả
            </button>
            <button
              onClick={() => setPaymentFilter('paid')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 ${paymentFilter === 'paid' ? 'bg-emerald-600 text-white shadow-sm' : 'text-faint hover:text-ok'}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" /> Đã xong
            </button>
            <button
              onClick={() => setPaymentFilter('unpaid')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 ${paymentFilter === 'unpaid' ? 'bg-rose-600 text-white shadow-sm' : 'text-faint hover:text-rose-600'}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" /> Còn nợ
            </button>
          </div>
        </div>
      </div>

      {/* Loading / Empty */}
      {loading ? (
        <div className="vl-card p-16 text-center text-faint">
          <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" /> Đang tải dữ liệu...
        </div>
      ) : zoneGroups.length === 0 ? (
        <div className="vl-card p-16 text-center text-faint">
          <div className="flex flex-col items-center justify-center">
            <FileSpreadsheet className="w-12 h-12 text-faint mb-3" />
            <p className="text-sm">Không tìm thấy khách hàng nào khớp bộ lọc</p>
          </div>
        </div>
      ) : (
        /* ── Mỗi Khu công nghiệp một bảng ── */
        zoneGroups.map(zone => (
          <div key={zone.code} className="vl-card overflow-hidden scroll-mt-6">
            {/* Zone header — màu chung cho mọi KCN, bấm để đóng/mở bảng */}
            <div
              onClick={() => toggleZone(zone.code)}
              className={`bg-gradient-to-r ${ZONE_HEADER_GRADIENT} px-5 md:px-7 py-4 flex items-center justify-between gap-3 cursor-pointer select-none`}
            >
              <div className="flex items-center gap-3 text-white min-w-0">
                <div className="p-2 bg-surface/20 rounded-xl shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-black tracking-tight leading-tight truncate">{zone.name}</h3>
                  <p className="text-[11px] font-semibold text-white/80">{zone.customers.length} khách hàng</p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {zone.unpaidCount > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-black shadow-sm flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> {zone.unpaidCount} còn nợ
                  </span>
                )}
                <ChevronDown
                  className={`w-5 h-5 text-white transition-transform duration-200 ${collapsedZones[zone.code] ? '-rotate-90' : ''}`}
                />
              </div>
            </div>

            {/* Zone table — đóng/mở có animation */}
            <AnimatePresence initial={false}>
              {!collapsedZones[zone.code] && (
                <motion.div
                  key="zone-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="overflow-x-auto">
                    <table className="vl-table w-full text-left border-collapse table-fixed min-w-[850px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                    <th className="py-3.5 px-4 w-[150px]">Mã khách hàng</th>
                    <th className="py-3.5 px-4 w-[28%]">Tên doanh nghiệp</th>
                    <th className="py-3.5 px-4 w-[14%] text-center">Ngày chốt chỉ số</th>
                    <th className="py-3.5 px-4 w-[18%] text-center">Ngày thanh toán</th>
                    <th className="py-3.5 px-4 w-[12%] text-right">Sản lượng điện</th>
                    <th className="py-3.5 px-4 w-[14%] text-right">Số tiền hóa đơn</th>
                    <th className="py-3.5 px-4 text-center w-[14%]">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {zone.customers.map(renderCustomerRows)}
                </tbody>
                <tfoot>
                  <tr className="bg-surface border-t-2 border-[var(--border-strong)] text-sm font-black text-ink">
                    <td colSpan={4} className="py-3.5 px-4 text-right uppercase text-xs tracking-wider text-dim">
                      Tổng cộng
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-warn">
                      <div>{fmtKWh(zone.slHC)} <span className="text-[9px] text-warn/60">kWh</span></div>
                      {zone.slVC > 0 && <div className="text-[10px] text-soft font-bold">{fmtKWh(zone.slVC)} kVarh</div>}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-accent">
                      <div>{fmtVND(zone.dtHC + zone.dtVC)}</div>
                      {zone.dtVC > 0 && <div className="text-[10px] text-soft font-bold">VC: {fmtVND(zone.dtVC)}</div>}
                    </td>
                    <td className="py-3.5 px-4" />
                  </tr>
                </tfoot>
                    </table>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))
      )}
    </div>
  );
}
