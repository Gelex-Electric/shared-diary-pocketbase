import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { pb } from '../../lib/pocketbase';
import { DatePicker, MonthPicker } from '../ui/DateTimePickers';
import { createNotification } from '../ui/NotificationBell';
import { Tabs, type TabItem } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { ProgressBar } from '../ui/dashboard';
import {
  Wallet, Zap, DollarSign, UserX, CheckCircle2, XCircle,
  Search, ChevronRight, ChevronDown, FileSpreadsheet, Building2,
  RefreshCw, X, Loader2, Save, Banknote, LayoutDashboard, Table2, CalendarClock, AlertTriangle,
  Receipt, BellRing, KeyRound,
} from 'lucide-react';

/* ============================================================
   Công nợ khách hàng — gộp dữ liệu từ collection `invoice`:
   - Tách thành nhiều bảng theo Khu công nghiệp (suy từ tiền tố MKHang).
   - Cấp 1: theo MKHang (khách hàng) — tổng hợp toàn bộ kỳ.
   - Cấp 2 (mở rộng): theo (MKHang + EndDate) — mỗi kỳ chốt chỉ số
     (có thể gồm nhiều công tơ cùng ngày EndDate).
   "Ngày thanh toán" (trường NTToan) ghi đồng nhất cho mọi bản ghi
   trong 1 kỳ. Khối Kinh doanh: đầy đủ chức năng. Khối Vận hành dùng
   lại với readOnly=true — chỉ xem, lọc theo KCN của tài khoản.
============================================================ */

import { toast as notify } from '../../lib/toast';
import { LoadingOverlay } from '../ui/LoadingOverlay';
import { PdfViewer } from '../ui/PdfViewer';
import { fetchEinvoicePdf, requestBillval, type EinvoicePdfType } from '../../lib/einvoiceApi';
import { zoneFromArea, fetchLatestInvoiceMonth } from '../../lib/invoices';

type ToastType = 'success' | 'error' | 'warning' | 'info';
type PaymentFilter = 'all' | 'paid' | 'unpaid';
type DebtTab = 'summary' | 'detail';

const DEBT_TABS: TabItem<DebtTab>[] = [
  { id: 'summary', label: 'Tổng hợp', icon: LayoutDashboard, sub: 'Chỉ tiêu chung & tiến trình thanh toán' },
  { id: 'detail', label: 'Chi tiết', icon: Table2, sub: 'Bảng công nợ theo từng khu công nghiệp' },
];

const TOAST_TITLE: Record<ToastType, string> = {
  success: 'Thành công', error: 'Lỗi', warning: 'Lưu ý', info: 'Thông báo',
};

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
  dtHC: number;   // doanh thu TRƯỚC thuế (ThTien; đã gộp HC+PK). dtVC giữ 0.
  dtVC: number;   // không dùng (0 sau gộp)
  dtVAT: number;  // doanh thu SAU thuế (ThTienVAT)
  vat: number;    // thuế suất đại diện (0.08 / 0)
}

interface KyGroup extends Totals {
  key: string;       // MKHang|LoaiHD|B:BillId (hoặc fallback nối ngày MKHang|LoaiHD|SCT|StartDate)
  endDate: string;
  ids: string[];
  nTToan: string;     // '' nếu chưa thanh toán đồng nhất ở mọi công tơ trong kỳ
  /** BillId của hóa đơn (rỗng với dữ liệu cũ) — nối `einvoice` để xem PDF giấy báo / hóa đơn. */
  billId?: string;
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

const emptyTotals = (): Totals => ({ slHC: 0, slVC: 0, dtHC: 0, dtVC: 0, dtVAT: 0, vat: 0 });
const addTotals = (a: Totals, b: Totals) => {
  a.slHC += b.slHC; a.slVC += b.slVC; a.dtHC += b.dtHC; a.dtVC += b.dtVC; a.dtVAT += b.dtVAT;
  if (b.vat > 0) a.vat = b.vat;
};

/* Cộng dồn tổng của một danh sách kỳ (dùng khi lọc theo tab ở cấp kỳ). */
const sumTotals = (list: Totals[]): Totals => {
  const t = emptyTotals();
  list.forEach(x => addTotals(t, x));
  return t;
};

/* ── Hạn thanh toán tính từ NGÀY CHỐT CHỈ SỐ ──
   - quá 5 ngày → thanh tiến trình chuyển VÀNG (cảnh báo)
   - quá 7 ngày → thanh tiến trình chuyển ĐỎ (trễ hạn)
   - quá 3 ngày → ghi thêm "Quá hạn N ngày" (N = số ngày kể từ ngày chốt)
   Chỉ áp cho đợt CHƯA thu đủ; đợt đã thu đủ luôn màu xanh. */
const DUE_WARN_DAYS = 5;
const DUE_LATE_DAYS = 7;
const DUE_NOTE_DAYS = 3;

/** Số ngày đã trôi qua kể từ `date` (YYYY-MM-DD) đến hôm nay; <0 nếu chưa tới. */
const daysSince = (date: string) => {
  if (!date) return 0;
  const d = new Date();
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const [y, m, dd] = date.split('-').map(Number);
  if (!y || !m || !dd) return 0;
  return Math.floor((today - Date.UTC(y, m - 1, dd)) / 86400000);
};

/** Màu thanh tiến trình theo mức trễ hạn (đợt đã thu đủ luôn xanh). */
const dueTone = (paid: number, total: number, elapsed: number): 'ok' | 'bad' | 'warn' | 'accent' => {
  if (total > 0 && paid >= total) return 'ok';
  if (elapsed >= DUE_LATE_DAYS) return 'bad';
  if (elapsed >= DUE_WARN_DAYS) return 'warn';
  return 'accent';
};

/* Giới hạn theo KCN của tài khoản (khối Vận hành) và áp các thay đổi ngày thanh
   toán đang soạn (chưa lưu) để bảng/tiến trình phản ánh ngay. */
const applyScopeAndPending = (
  list: CustomerGroup[],
  pending: Record<string, string>,
  zoneLock: string,
): CustomerGroup[] => {
  const scoped = zoneLock ? list.filter(c => zoneOf(c.mkh) === zoneLock) : list;
  return scoped.map(c => {
    let unpaidCount = 0;
    const kyList = c.kyList.map(ky => {
      const nTToan = ky.key in pending ? pending[ky.key] : ky.nTToan;
      if (!nTToan) unpaidCount += 1;
      return { ...ky, nTToan };
    });
    return { ...c, kyList, unpaidCount, isPaid: unpaidCount === 0 };
  });
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

// Sản lượng & doanh thu của 1 bản ghi — đọc TRỰC TIẾP từ trường đã lưu (nạp thẳng từ XML).
// Hữu công: TongSL_HC (kWh) / ThTien_HC. Vô công (phản kháng): TongSL_PK (kVarh) / ThTien_PK.
function computeRecordTotals(r: DebtInvoiceRecord): Totals {
  const dt = num(r.ThTien) || (num(r.ThTien_HC) + num(r.ThTien_PK)); // trước thuế (gộp)
  const vat = num(r.VAT);
  return {
    slHC: num(r.TongSL_HC),
    slVC: num(r.TongSL_PK),
    dtHC: dt,
    dtVC: 0,
    dtVAT: num(r.ThTienVAT) || Math.round(dt * (1 + vat)),
    vat,
  };
}

export default function CustomerDebtManager({ readOnly = false }: { readOnly?: boolean }) {
  // Khối Vận hành (readOnly): chỉ thấy khách hàng thuộc KCN của tài khoản.
  const zoneLock = useMemo(
    () => (readOnly ? zoneFromArea(pb.authStore.model?.area) : ''),
    [readOnly],
  );
  const [records, setRecords] = useState<DebtInvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  // '' = chưa xác định tháng mặc định (đang hỏi tháng có dữ liệu mới nhất)
  const [monthFilter, setMonthFilter] = useState<string>('');
  const [tab, setTab] = useState<DebtTab>('summary');
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  // Lọc đúng MỘT đợt chốt (YYYY-MM-DD) khi bấm "Chi tiết" từ bảng tiến trình; '' = không lọc
  const [focusDate, setFocusDate] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  // Bảng KCN bị thu gọn (mặc định mở); key = mã KCN
  const [collapsedZones, setCollapsedZones] = useState<Record<string, boolean>>({});
  // Thay đổi ngày thanh toán đang soạn (chưa lưu): key kỳ → ngày ('' = chưa thanh toán)
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null);
  const showToast = useCallback((message: string, t: ToastType = 'info') => {
    notify.show(t, TOAST_TITLE[t], message);
  }, []);

  /* ── load: chỉ tải theo tháng đang xem (server-side filter trên EndDate) ── */
  const loadRecords = useCallback(async (ym: string) => {
    if (!ym) return; // chưa chốt tháng mặc định
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

  /* Mặc định = tháng có hóa đơn MỚI NHẤT (không phải tháng hiện tại — đầu tháng
     thường chưa có dữ liệu nên sẽ ra bảng rỗng). Chỉ chạy 1 lần lúc mở trang. */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchLatestInvoiceMonth().then(ym => {
      if (!alive) return;
      const d = new Date();
      const ymFinal = ym || `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      setMonthFilter(ymFinal);
      setYear(ymFinal.slice(0, 4));
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => { loadRecords(monthFilter); }, [loadRecords, monthFilter]);

  /* ── dữ liệu CẢ NĂM cho tab Tổng hợp (tiến trình thanh toán mỗi tháng một bảng).
        Chỉ lấy các trường cần cho việc gộp kỳ + tính tiền, tránh kéo cả bảng chỉ số. ── */
  /* Tab Tổng hợp chọn theo NĂM (độc lập với bộ chọn tháng của tab Chi tiết);
     khởi tạo theo năm của tháng có hóa đơn mới nhất. */
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    const years = new Set<number>();
    for (let y = now; y >= now - 5; y--) years.add(y);
    years.add(Number(year));
    return Array.from(years).sort((a, b) => b - a).map(y => ({ value: String(y), label: `Năm ${y}` }));
  }, [year]);
  const [yearRecords, setYearRecords] = useState<DebtInvoiceRecord[]>([]);
  const [yearLoading, setYearLoading] = useState(false);

  const loadYearRecords = useCallback(async (y: string) => {
    if (!y) return;
    setYearLoading(true);
    try {
      const filter = pb.filter('EndDate >= {:start} && EndDate < {:nextStart}', {
        start: `${y}-01-01`,
        nextStart: `${Number(y) + 1}-01-01`,
      });
      const list = await pb.collection('invoice').getFullList<DebtInvoiceRecord>({
        filter,
        sort: '-EndDate',
        fields: 'id,MKHang,NMua,SCT,StartDate,EndDate,IndexId,BillId,NTToan,LoaiHD,ThTien,ThTien_HC,ThTien_PK,ThTienVAT,VAT,TongSL_HC,TongSL_PK',
        requestKey: null,
      });
      setYearRecords(list);
    } catch (err: any) {
      showToast(`Lỗi tải tiến trình năm ${y}: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setYearLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadYearRecords(year); }, [loadYearRecords, year]);

  /* ── gộp cấp 1: theo MKHang ; cấp 2: HÓA ĐƠN (gộp khoảng đổi giá theo công tơ) ──
     Dùng chung cho dữ liệu THÁNG đang xem (bảng chi tiết) và dữ liệu CẢ NĂM
     (bảng tiến trình ở tab Tổng hợp). */
  const buildCustomers = useCallback((recs: DebtInvoiceRecord[]): CustomerGroup[] => {
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
      if (!g.billId) {
        const b = (r.BillId ?? '').toString().trim();
        if (b && b !== '0') g.billId = b;
      }
      addTotals(g, computeRecordTotals(r));
      if (end > g.endDate) g.endDate = end; // ngày chốt = EndDate muộn nhất
      ntByKey.get(key)!.push(dateOnly(r.NTToan));
    };

    // Tách 2 nhóm: có BillId (gộp thẳng theo BillId) và không có BillId (nối ngày theo công tơ)
    const noBill = new Map<string, DebtInvoiceRecord[]>();
    recs.forEach(r => {
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
  }, []);

  const customers = useMemo(() => buildCustomers(records), [buildCustomers, records]);

  /* ── Hóa đơn gốc (`einvoice`) theo BillId — để xem PDF giấy báo / hóa đơn từ CCIS ──
     Chuyển từ màn Biên bản sang đây (user chốt 02/10/2026). API PDF chỉ cho khối KD
     nên khối Vận hành (readOnly) không tải, không hiện nút. */
  const [einvByBill, setEinvByBill] = useState<Map<string, { id: string; billval?: string }>>(new Map());
  useEffect(() => {
    if (readOnly) return;
    const ids = Array.from(new Set(records.map(r => (r.BillId ?? '').toString().trim()).filter(b => b && b !== '0')));
    if (!ids.length) { setEinvByBill(new Map()); return; }
    let alive = true;
    (async () => {
      const out = new Map<string, { id: string; billval?: string }>();
      try {
        for (let i = 0; i < ids.length; i += 50) {
          const filter = ids.slice(i, i + 50).map(b => pb.filter('BillId = {:b}', { b })).join(' || ');
          const items = await pb.collection('einvoice').getFullList<{ id: string; BillId: string; billval?: string }>({
            filter, fields: 'id,BillId,billval', requestKey: null,
          });
          items.forEach(e => out.set(e.BillId, { id: e.id, billval: e.billval }));
        }
      } catch { /* chưa có quyền / lỗi mạng: chỉ không hiện nút xem PDF */ }
      if (alive) setEinvByBill(out);
    })();
    return () => { alive = false; };
  }, [records, readOnly]);

  /** Lớp phủ chờ khi tải PDF / lấy BILLVAL (tải từ CCIS mất vài giây). */
  const [ccisWait, setCcisWait] = useState<{ title: string; hint?: string } | null>(null);
  /** PDF đang xem trong app (`ui/PdfViewer`) — không mở tab mới / `about:blank` (user chốt 02/10/2026). */
  const [pdfView, setPdfView] = useState<{ blob: Blob; fileName: string; title: string } | null>(null);
  const closePdf = useCallback(() => setPdfView(null), []);
  const openPdf = async (ky: KyGroup, type: EinvoicePdfType) => {
    const e = ky.billId ? einvByBill.get(ky.billId) : undefined;
    if (!e) return;
    const label = type === 'NOTI' ? 'Giấy báo tiền điện' : 'Hóa đơn điện tử';
    setCcisWait({ title: `Đang tải ${label.toLowerCase()} từ CCIS…`, hint: `Kỳ ${fmtDate(ky.endDate)}` });
    try {
      const file = await fetchEinvoicePdf(e.id, type);
      setPdfView({ ...file, title: `${label} — kỳ ${fmtDate(ky.endDate)}` });
    }
    catch (err: any) { showToast(`Không mở được PDF: ${err?.message || ''}`, 'error'); }
    finally { setCcisWait(null); }
  };
  const getBillval = async (ky: KyGroup) => {
    const e = ky.billId ? einvByBill.get(ky.billId) : undefined;
    if (!e) return;
    setCcisWait({ title: 'Đang tra CCIS để lấy BILLVAL…', hint: `Kỳ ${fmtDate(ky.endDate)}` });
    try {
      await requestBillval(e.id);
      setEinvByBill(prev => new Map(prev).set(ky.billId!, { ...e, billval: 'ok' })); // chỉ cần biết đã có
      showToast('Đã lấy BILLVAL — bấm Giấy báo / Hóa đơn để xem', 'success');
    } catch (err: any) { showToast(`Không lấy được BILLVAL: ${err?.message || ''}`, 'error'); }
    finally { setCcisWait(null); }
  };

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
  const effectiveCustomers = useMemo<CustomerGroup[]>(
    () => applyScopeAndPending(customers, pending, zoneLock),
    [customers, pending, zoneLock],
  );

  /* ── số thay đổi thực sự (khác giá trị gốc) đang chờ lưu ── */
  const pendingCount = useMemo(
    () => Object.entries(pending).filter(([key, date]) => {
      const info = kyIndex.get(key);
      return info && (date || '') !== (info.original || '');
    }).length,
    [pending, kyIndex],
  );

  /* ── KPI tổng quan (theo phạm vi tháng đang chọn, không phụ thuộc tìm kiếm/lọc) ──
     "Chưa thanh toán" tính ở CẤP KỲ: chỉ cộng các kỳ chưa có NTToan, nên khách trả
     một phần chỉ góp phần tiền còn thiếu (không cộng cả các kỳ đã trả). */
  const kpis = useMemo(() => {
    const unpaidKy = effectiveCustomers.flatMap(c => c.kyList.filter(ky => !ky.nTToan));
    const unpaid = sumTotals(unpaidKy);
    return {
      unpaidCustomers: effectiveCustomers.filter(c => !c.isPaid).length,
      slHC: effectiveCustomers.reduce((s, c) => s + c.slHC, 0),
      slVC: effectiveCustomers.reduce((s, c) => s + c.slVC, 0),
      dtHC: effectiveCustomers.reduce((s, c) => s + c.dtHC, 0),
      dtVC: effectiveCustomers.reduce((s, c) => s + c.dtVC, 0),
      dtVAT: effectiveCustomers.reduce((s, c) => s + c.dtVAT, 0),
      unpaidKyCount: unpaidKy.length,
      unpaidPre: unpaid.dtHC + unpaid.dtVC,
      unpaidVAT: unpaid.dtVAT,
    };
  }, [effectiveCustomers]);

  /* ── tiến trình thanh toán theo NGÀY CHỐT CHỈ SỐ ──
     Gom mọi kỳ trong tháng đang xem theo `endDate`; mỗi ngày chốt là một nhóm
     khách hàng. Một khách được tính "đã thanh toán" của ngày đó khi MỌI kỳ chốt
     đúng ngày đó của họ đều đã có ngày thanh toán. Không phụ thuộc tìm kiếm/tab
     lọc (giống các thẻ KPI). */
  const effectiveYearCustomers = useMemo<CustomerGroup[]>(
    () => applyScopeAndPending(buildCustomers(yearRecords), pending, zoneLock),
    [buildCustomers, yearRecords, pending, zoneLock],
  );

  const dateProgress = useMemo(() => {
    const map = new Map<string, { date: string; paid: number; total: number; unpaidVAT: number; dtVAT: number }>();
    effectiveYearCustomers.forEach(c => {
      const byDate = new Map<string, KyGroup[]>();
      c.kyList.forEach(ky => {
        if (!ky.endDate) return;
        if (!byDate.has(ky.endDate)) byDate.set(ky.endDate, []);
        byDate.get(ky.endDate)!.push(ky);
      });
      byDate.forEach((kys, date) => {
        let g = map.get(date);
        if (!g) { g = { date, paid: 0, total: 0, unpaidVAT: 0, dtVAT: 0 }; map.set(date, g); }
        g.total += 1;
        if (kys.every(ky => !!ky.nTToan)) g.paid += 1;
        kys.forEach(ky => {
          g!.dtVAT += ky.dtVAT;
          if (!ky.nTToan) g!.unpaidVAT += ky.dtVAT;
        });
      });
    });
    return Array.from(map.values())
      .map(g => ({ ...g, elapsed: daysSince(g.date) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [effectiveYearCustomers]);

  /* Mỗi THÁNG một bảng: gom các ngày chốt trong năm theo tháng (mới → cũ). */
  const monthProgress = useMemo(() => {
    const map = new Map<string, { ym: string; rows: typeof dateProgress; paid: number; total: number; unpaidVAT: number; worstElapsed: number }>();
    dateProgress.forEach(r => {
      const ym = r.date.slice(0, 7);
      let g = map.get(ym);
      if (!g) { g = { ym, rows: [], paid: 0, total: 0, unpaidVAT: 0, worstElapsed: 0 }; map.set(ym, g); }
      g.rows.push(r);
      g.paid += r.paid;
      g.total += r.total;
      g.unpaidVAT += r.unpaidVAT;
      // Mức trễ của tháng = đợt CHƯA thu đủ trễ nhất
      if (r.paid < r.total) g.worstElapsed = Math.max(g.worstElapsed, r.elapsed);
    });
    return Array.from(map.values()).sort((a, b) => b.ym.localeCompare(a.ym));
  }, [dateProgress]);

  /* Bấm "Chi tiết" ở một đợt chưa thu đủ: nhảy sang tab Chi tiết, đặt đúng tháng,
     bật bộ lọc "Còn nợ" và ghim đúng ngày chốt của đợt đó. */
  const openUnpaidDetail = (date: string) => {
    setPending({});
    setSearch('');
    setMonthFilter(date.slice(0, 7));
    setPaymentFilter('unpaid');
    setFocusDate(date);
    setExpandedGroups({});
    setTab('detail');
  };

  /* ── lọc theo tìm kiếm + trạng thái thanh toán ──
     Lọc Ở CẤP KỲ: tab "Đã xong" chỉ giữ các kỳ đã có ngày thanh toán, tab "Còn nợ"
     chỉ giữ các kỳ chưa trả; tổng của khách & của KCN được cộng lại từ đúng các kỳ
     còn hiển thị, nên số tiền mỗi tab khớp với những gì đang thấy trên bảng. */
  const displayCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: CustomerGroup[] = [];
    effectiveCustomers.forEach(c => {
      if (q && !c.mkh.toLowerCase().includes(q) && !c.nMua.toLowerCase().includes(q)) return;
      if (paymentFilter === 'all' && !focusDate) { out.push(c); return; }
      const kyList = c.kyList.filter(ky => {
        if (focusDate && ky.endDate !== focusDate) return false;
        if (paymentFilter === 'all') return true;
        return paymentFilter === 'paid' ? !!ky.nTToan : !ky.nTToan;
      });
      if (kyList.length === 0) return;
      const unpaidCount = kyList.filter(ky => !ky.nTToan).length;
      out.push({
        ...c, ...sumTotals(kyList), kyList, unpaidCount, isPaid: unpaidCount === 0,
      });
    });
    return out;
  }, [effectiveCustomers, search, paymentFilter, focusDate]);

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
              kind: 'thanhtoan',
              mkh: info.mkh,
              area: kcnArea,
            });
          }
        }
        setSaveProgress({ done: i + 1, total: entries.length });
      }
      await Promise.all([loadRecords(monthFilter), loadYearRecords(year)]);
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
            <div className="text-dim font-bold">{fmtVND(c.dtHC + c.dtVC)}</div>
          </td>
          <td className="py-3.5 px-4 text-right font-mono text-xs">
            <div className="text-ink font-bold">{fmtVND(c.dtVAT)}</div>
            {c.vat > 0 && <div className="text-[9px] text-faint font-semibold">VAT {Math.round(c.vat * 100)}%</div>}
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
                {/* Xem PDF giấy báo / hóa đơn — chỉ khi hóa đơn đã nạp XML (có einvoice). */}
                {(() => {
                  const e = !readOnly && ky.billId ? einvByBill.get(ky.billId) : undefined;
                  if (!e) return null;
                  const btn = 'vl-btn vl-btn-sm flex items-center gap-1 !px-2 !py-0.5 text-[11px] not-italic';
                  return (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {e.billval ? (<>
                        <button onClick={() => void openPdf(ky, 'NOTI')} disabled={!!ccisWait}
                          title="Xem giấy báo tiền điện (PDF)" className={`${btn} vl-btn-outline-primary`}>
                          <BellRing className="h-3 w-3" /> Giấy báo
                        </button>
                        <button onClick={() => void openPdf(ky, 'BILLPDF')} disabled={!!ccisWait}
                          title="Xem hóa đơn điện tử (PDF)" className={`${btn} vl-btn-outline-primary`}>
                          <Receipt className="h-3 w-3" /> Hóa đơn
                        </button>
                      </>) : (
                        <button onClick={() => void getBillval(ky)} disabled={!!ccisWait}
                          title="Tra CCIS để mở được PDF giấy báo / hóa đơn" className={`${btn} vl-btn-warning`}>
                          <KeyRound className="h-3 w-3" /> Lấy BILLVAL
                        </button>
                      )}
                    </div>
                  );
                })()}
              </td>
              <td className="py-3 px-4 text-center font-mono text-[11px] text-soft">
                {fmtDate(ky.endDate)}
              </td>
              <td className="py-3 px-4 text-center">
                {readOnly ? (
                  ky.nTToan ? (
                    <span className="font-mono text-[11px] font-bold text-ok">{fmtDate(ky.nTToan)}</span>
                  ) : (
                    <span className="text-rose-500/80 font-semibold text-[11px]">Chưa thanh toán</span>
                  )
                ) : (
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
                )}
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
              <td className="py-3 px-4 text-right font-mono text-[11px]">
                <div className="text-accent font-bold">{fmtVND(ky.dtVAT)}</div>
                {ky.vat > 0 && <div className="text-[9px] text-faint font-semibold">VAT {Math.round(ky.vat * 100)}%</div>}
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
          {/* Tổng hợp: chọn NĂM (tiến trình cả năm). Chi tiết: chọn THÁNG (bảng KCN). */}
          {tab === 'summary' ? (
            <Select
              value={year}
              onChange={v => { setPending({}); setYear(v); }}
              options={yearOptions}
              icon={CalendarClock}
              className="min-w-[170px]"
            />
          ) : (
            <MonthPicker
              value={monthFilter}
              onChange={v => { setPending({}); setFocusDate(''); setMonthFilter(v); }}
              allowAll
              className="min-w-[170px]"
            />
          )}
          {tab === 'detail' && (
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
          )}
        </div>
      </div>

      {/* Tab: Tổng hợp (chỉ tiêu + tiến trình) | Chi tiết (bảng theo KCN) */}
      <Tabs<DebtTab> tabs={DEBT_TABS} value={tab} onChange={setTab} />

      {tab === 'summary' && (
      <>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="vl-card p-6 md:p-7 hover:-translate-y-1 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider">Số khách hàng chưa thanh toán</span>
            <div className="p-2.5 bg-rose-50 rounded-2xl text-rose-500 group-hover:scale-110 transition-transform">
              <UserX className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-ink tracking-tight leading-none font-mono">{fmtKWh(kpis.unpaidCustomers)}</h3>
        </div>

        {/* Số tiền còn chưa thanh toán — cộng theo KỲ chưa có ngày thanh toán,
            trong phạm vi tháng đang chọn (không đổi theo tab / ô tìm kiếm). */}
        <div className="vl-card p-6 md:p-7 hover:-translate-y-1 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider">Số tiền chưa thanh toán</span>
            <div className="p-2.5 bg-rose-50 rounded-2xl text-rose-500 group-hover:scale-110 transition-transform">
              <Banknote className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-rose-600 tracking-tight leading-none font-mono">{fmtVND(kpis.unpaidVAT)}</h3>
          <p className="text-[11px] font-bold text-soft mt-1 font-mono">
            {fmtVND(kpis.unpaidPre)} <span className="text-[9px] text-faint font-semibold">trước thuế</span>
            <span className="text-faint font-semibold"> · {kpis.unpaidKyCount} kỳ</span>
          </p>
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
          <p className="text-[11px] font-bold text-accent mt-1 font-mono">{fmtVND(kpis.dtVAT)} <span className="text-[9px] text-faint font-semibold">sau thuế</span></p>
        </div>
      </div>

      {/* Tiến trình thanh toán theo ngày chốt chỉ số — CẢ NĂM, mỗi tháng một bảng */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-accent-soft rounded-xl text-accent shrink-0">
          <CalendarClock className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-black text-ink uppercase tracking-wide">
            Tiến trình thanh toán theo ngày chốt chỉ số — năm {year}
          </h3>
          <p className="text-[11px] font-semibold text-soft">
            Mỗi tháng một bảng; mỗi dòng là nhóm khách hàng có cùng ngày chốt — tỷ lệ khách đã thanh toán đủ mọi hóa đơn của ngày đó.
          </p>
        </div>
      </div>

      {yearLoading ? (
        <div className="vl-card p-16 text-center text-faint">
          <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" /> Đang tải tiến trình năm {year}...
        </div>
      ) : monthProgress.length === 0 ? (
        <div className="vl-card p-16 text-center text-faint">
          <div className="flex flex-col items-center justify-center">
            <FileSpreadsheet className="w-12 h-12 text-faint mb-3" />
            <p className="text-sm">Chưa có hóa đơn nào trong năm {year}</p>
          </div>
        </div>
      ) : (
        monthProgress.map(mp => {
          const [my, mm] = mp.ym.split('-');
          return (
            <div key={mp.ym} className="vl-card overflow-hidden">
              {/* Header tháng — cùng kiểu thanh gradient với bảng KCN */}
              <div className={`bg-gradient-to-r ${ZONE_HEADER_GRADIENT} px-5 md:px-7 py-4 flex items-center justify-between gap-3`}>
                <div className="flex items-center gap-3 text-white min-w-0">
                  <div className="p-2 bg-surface/20 rounded-xl shrink-0">
                    <CalendarClock className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-black tracking-tight leading-tight">Tháng {mm}/{my}</h3>
                    <p className="text-[11px] font-semibold text-white/80">
                      {mp.rows.length} đợt chốt · {mp.paid}/{mp.total} khách hàng đã thanh toán
                    </p>
                  </div>
                </div>
                {mp.unpaidVAT > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-black shadow-sm shrink-0 font-mono">
                    Còn {fmtVND(mp.unpaidVAT)} đ
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="vl-table w-full text-left border-collapse table-fixed min-w-[640px]">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                      <th className="py-3 px-4 w-[170px]">Ngày chốt chỉ số</th>
                      <th className="py-3 px-4 w-[100px] text-center">Khách hàng</th>
                      <th className="py-3 px-4">Tiến trình thanh toán</th>
                      <th className="py-3 px-4 w-[110px] text-center">Đã / Tổng</th>
                      <th className="py-3 px-4 w-[150px] text-right">Còn phải thu</th>
                      <th className="py-3 px-4 w-[100px] text-center">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {mp.rows.map(g => {
                      const done = g.paid >= g.total;
                      const tone = dueTone(g.paid, g.total, g.elapsed);
                      const overdue = !done && g.elapsed > DUE_NOTE_DAYS;
                      return (
                        <tr key={g.date} className="text-sm">
                          <td className="py-3 px-4 font-mono font-bold text-ink">
                            <div>{fmtDate(g.date)}</div>
                            {overdue && (
                              <div
                                className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black ${
                                  tone === 'bad' ? 'bg-rose-100 text-rose-700' : 'bg-[var(--warning-soft)] text-warn'
                                }`}
                                title={`Hạn cảnh báo ${DUE_WARN_DAYS} ngày, trễ hạn ${DUE_LATE_DAYS} ngày kể từ ngày chốt`}
                              >
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                Quá hạn {g.elapsed} ngày
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center font-mono text-xs text-soft">{g.total}</td>
                          <td className="py-3 px-4">
                            <ProgressBar
                              value={g.paid}
                              total={g.total}
                              tone={tone}
                              title={`${g.paid}/${g.total} khách hàng đã thanh toán${overdue ? ` · quá hạn ${g.elapsed} ngày` : ''}`}
                            />
                          </td>
                          <td className="py-3 px-4 text-center font-mono text-xs font-bold">
                            <span className={done ? 'text-ok' : 'text-accent'}>{g.paid}</span>
                            <span className="text-faint">/{g.total}</span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs font-bold">
                            {g.unpaidVAT > 0 ? (
                              <span className="text-rose-600">{fmtVND(g.unpaidVAT)}</span>
                            ) : (
                              <span className="text-ok">Đã thu đủ</span>
                            )}
                          </td>
                          {/* Đợt chưa thu đủ → mở thẳng danh sách khách còn nợ của đúng đợt này */}
                          <td className="py-3 px-4 text-center">
                            {done ? (
                              <span className="text-faint text-xs">—</span>
                            ) : (
                              <button
                                onClick={() => openUnpaidDetail(g.date)}
                                className="inline-flex items-center gap-1 text-xs font-bold text-accent hover:underline"
                                title={`Xem ${g.total - g.paid} khách hàng chưa thanh toán của đợt ${fmtDate(g.date)}`}
                              >
                                Chi tiết <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {/* Dòng tổng — tô nền accent + viền trên dày để tách hẳn khỏi các dòng ngày chốt */}
                    <tr className="bg-accent-soft border-t-2 border-t-[var(--accent)] text-sm font-black text-ink">
                      <td colSpan={2} className="py-3.5 px-4 text-right uppercase text-[11px] tracking-widest text-accent">
                        Tổng tháng {mm}/{my}
                      </td>
                      <td className="py-3.5 px-4">
                        <ProgressBar
                          value={mp.paid}
                          total={mp.total}
                          tone={dueTone(mp.paid, mp.total, mp.worstElapsed)}
                          title={`${mp.paid}/${mp.total} khách hàng đã thanh toán trong tháng`}
                        />
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono text-sm font-black">
                        <span className={mp.paid === mp.total ? 'text-ok' : 'text-accent'}>{mp.paid}</span>
                        <span className="text-faint">/{mp.total}</span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-sm font-black">
                        {mp.unpaidVAT > 0 ? (
                          <span className="text-rose-600">{fmtVND(mp.unpaidVAT)}</span>
                        ) : (
                          <span className="text-ok">Đã thu đủ</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })
      )}
      </>
      )}

      {tab === 'detail' && (
      <>
      {/* Thanh điều khiển: tải lại + lọc trạng thái + chú thích màu */}
      <div className="vl-card p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-[11px] font-semibold text-soft flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-100 border-l-4 border-l-emerald-400 shrink-0" /> Đã thanh toán
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-100 border-l-4 border-l-rose-500 shrink-0" /> Còn nợ
          </span>
          {/* Đang ghim một đợt chốt (mở từ bảng tiến trình) — bấm X để xem cả tháng */}
          {focusDate && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent-soft text-accent text-[11px] font-black">
              <CalendarClock className="w-3.5 h-3.5 shrink-0" />
              Đợt chốt {fmtDate(focusDate)}
              <button
                onClick={() => setFocusDate('')}
                title="Bỏ lọc theo đợt chốt"
                className="p-0.5 rounded hover:bg-[var(--danger-soft)] hover:text-red-500 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Lưu thay đổi (chỉ lưu khi bấm nút này) — ẩn với khối Vận hành */}
          {!readOnly && (
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
          )}

          {!readOnly && pendingCount > 0 && !saving && (
            <button
              onClick={discardChanges}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-[var(--border)] rounded-lg text-sm font-bold text-soft hover:bg-subtle transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Hủy
            </button>
          )}

          <button
            onClick={() => { setPending({}); loadRecords(monthFilter); loadYearRecords(year); }}
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
                    <th className="py-3.5 px-4 w-[120px]">Mã khách hàng</th>
                    <th className="py-3.5 px-4 w-[19%]">Tên doanh nghiệp</th>
                    <th className="py-3.5 px-4 w-[11%] text-center">Ngày chốt chỉ số</th>
                    <th className="py-3.5 px-4 w-[15%] text-center">Ngày thanh toán</th>
                    <th className="py-3.5 px-4 w-[10%] text-right">Sản lượng điện</th>
                    <th className="py-3.5 px-4 w-[13%] text-right">Số tiền trước thuế</th>
                    <th className="py-3.5 px-4 w-[13%] text-right">Số tiền sau thuế</th>
                    <th className="py-3.5 px-4 text-center w-[12%]">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {zone.customers.map(renderCustomerRows)}
                </tbody>
                <tfoot>
                  <tr className="bg-accent-soft border-t-2 border-t-[var(--accent)] text-sm font-black text-ink">
                    <td colSpan={4} className="py-3.5 px-4 text-right uppercase text-[11px] tracking-widest text-accent">
                      Tổng cộng
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-warn">
                      <div>{fmtKWh(zone.slHC)} <span className="text-[9px] text-warn/60">kWh</span></div>
                      {zone.slVC > 0 && <div className="text-[10px] text-soft font-bold">{fmtKWh(zone.slVC)} kVarh</div>}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-dim">{fmtVND(zone.dtHC + zone.dtVC)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-accent">{fmtVND(zone.dtVAT)}</td>
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
      </>
      )}
      <LoadingOverlay open={!!ccisWait} title={ccisWait?.title ?? ''} hint={ccisWait?.hint} />
      <PdfViewer file={pdfView} title={pdfView?.title ?? ''} onClose={closePdf} />
    </div>
  );
}
