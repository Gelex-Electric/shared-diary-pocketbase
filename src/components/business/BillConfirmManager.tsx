import { useMemo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { pb } from '../../lib/pocketbase';
import { MonthPicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import { generateBbxnDocx } from '../../lib/bbxnDocx';
import { AccountHes, DataMetter } from '../../types';
import { zoneFromArea, zoneOf, ZONE_MAP, fetchLatestInvoiceMonth } from '../../lib/invoices';
import { zoneHexOf } from '../../lib/kcnColors';
import PizZip from 'pizzip';
import {
  FileCheck2, Users, ChevronRight, Trash2, FileDown, Search, FileSpreadsheet,
  CreditCard, RefreshCw, Zap, CheckSquare, Square, Archive,
} from 'lucide-react';

/* ============================================================
   Biên bản xác nhận chỉ số (collection PocketBase: invoice)
   - Dữ liệu CHỈ đến từ XML ở màn "Nạp dữ liệu" (user chốt 01/10/2026): đã bỏ
     "Tạo biên bản mới" và nút Sửa. Còn xóa, tải Word, đồng bộ thời gian lấy chỉ số.
   - Xem PDF giấy báo / hóa đơn: chuyển sang Công nợ khách hàng → tab Chi tiết (02/10/2026).
   - Chỉ số đầu/cuối kỳ 5 thành phần: PG, BT, CD, TD, VC
   - Sản lượng = (cuối - đầu) * HSN
   - Biểu cuối = sản lượng - biểu phụ
   - Cosφ = biểu Tổng / √(biểu Tổng² + biểu VC²)
   Khối Kinh doanh: đầy đủ chức năng. Khối Vận hành dùng lại với
   readOnly=true — chỉ xem + tải Word, dữ liệu lọc theo KCN tài khoản.
============================================================ */

import { toast as notify } from '../../lib/toast';

type ToastType = 'success' | 'error' | 'warning' | 'info';

const TOAST_TITLE: Record<ToastType, string> = {
  success: 'Thành công', error: 'Lỗi', warning: 'Lưu ý', info: 'Thông báo',
};

// 4 thành phần chỉ số nhập tay. Tổng (tác dụng) = BT+CĐ+TĐ; VC = vô công (phản kháng).
const COMPONENTS = [
  { key: 'BT', label: 'BT — Bình thường' },
  { key: 'CD', label: 'CD — Cao điểm' },
  { key: 'TD', label: 'TD — Thấp điểm' },
  { key: 'VC', label: 'VC — Vô công (phản kháng)' },
] as const;

// Biểu phụ theo từng thành phần (không còn phu_Tong)
const PHU_KEYS = ['BT', 'CD', 'TD', 'VC'] as const;

interface InvoiceRecord {
  id: string;
  StartDate: string;
  EndDate: string;
  NBan: string;
  DChiNBan: string;
  NMua: string;
  MKHang: string;
  DChiNMua: string;
  SCT: string;
  HSN: number;
  IndexId?: string;
  BillId?: string;
  [key: string]: any; // BT_dau/cuoi..., phu_BT..., SL_BT..., TongSL_*, ThTien_*
  created: string;
  updated: string;
}

/* Một dòng biên bản sau khi gộp các khoảng đổi giá (cùng BillId) thành 1 kỳ liên tục. */
interface BienBanRow {
  key: string;            // SCT|B:BillId (fallback nối ngày SCT|StartDate, hoặc __id:<id>)
  ids: string[];          // id các bản ghi gốc (>1 nếu hóa đơn đổi giá)
  primary: InvoiceRecord; // bản ghi mới nhất theo EndDate — nguồn meta/NKy + thao tác đơn lẻ
  data: InvoiceRecord;    // dữ liệu đã gộp để tính toán & xuất Word
  merged: boolean;        // true nếu gộp từ ≥2 khoảng
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// "YYYY-MM" của tháng hiện tại, dùng làm mặc định cho bộ lọc tháng
const currentYearMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

// Đọc ngược câu NKy có sẵn (dữ liệu cũ) ra { date, time } để đổ vào picker
const parseNKySentence = (s?: string): { date: string; time: string } => {
  if (!s) return { date: '', time: '00:00' };
  const m = s.match(/(\d{1,2})\s*giờ\s*(\d{1,2})\s*phút\s*ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/);
  if (!m) return { date: '', time: '00:00' };
  const [, hh, mi, d, mo, y] = m;
  return { date: `${y}-${pad2(Number(mo))}-${pad2(Number(d))}`, time: `${pad2(Number(hh))}:${pad2(Number(mi))}` };
};

// Format yyyyMMddHHmmss cho HES API
const toHesDateStr = (date: string, hh: string, mm: string): string => {
  const [y, m, d] = date.split('-');
  return `${y}${m}${d}${hh}${mm}00`;
};

const num = (v: any) => {
  const n = parseFloat((v ?? '').toString().replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number, digits = 0) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(n);

// Hiển thị ngày dd/mm/yyyy từ chuỗi PocketBase (YYYY-MM-DD hoặc ISO)
const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];
const fmtDate = (s?: string) => {
  if (!s) return '—';
  const datePart = dateOnly(s);
  const [y, m, d] = datePart.split('-');
  return d && m && y ? `${d}/${m}/${y}` : s;
};

// Hiển thị thời gian lấy chỉ số từ câu NKy → chỉ giờ "HH:MM" ('' nếu chưa có)
const fmtNKy = (s?: string): string => {
  const { date, time } = parseNKySentence(s);
  if (!date) return '';
  return time;
};

// Màu phân biệt theo khu công nghiệp — bảng màu đã chuyển sang `lib/kcnColors`
// (ZONE_HEX) để màn Hợp đồng QLVH dùng đúng một bộ màu, không khai lại bản thứ hai.
const zoneColor = (mkh: string) => zoneHexOf(zoneOf(mkh));

// Gộp nhiều khoảng đổi giá của cùng công tơ thành 1 bản ghi biên bản liên tục:
// đầu kỳ = chỉ số đầu của khoảng sớm nhất, cuối kỳ = chỉ số cuối của khoảng muộn nhất,
// biểu phụ = tổng các khoảng (giá không ảnh hưởng biên bản chỉ số).
function mergeBienBan(recs: InvoiceRecord[]): InvoiceRecord {
  if (recs.length === 1) return recs[0];
  const byStart = [...recs].sort((a, b) =>
    dateOnly(a.StartDate).localeCompare(dateOnly(b.StartDate)) ||
    dateOnly(a.EndDate).localeCompare(dateOnly(b.EndDate)));
  const first = byStart[0];
  const last = byStart[byStart.length - 1];
  const merged: any = { ...last }; // meta (NMua/MKHang/NBan/NKy/HSN/SCT...) lấy theo khoảng muộn nhất
  merged.StartDate = first.StartDate;
  merged.EndDate = last.EndDate;
  COMPONENTS.forEach(c => {
    merged[`${c.key}_dau`] = first[`${c.key}_dau`];
    merged[`${c.key}_cuoi`] = last[`${c.key}_cuoi`];
  });
  PHU_KEYS.forEach(k => {
    merged[`phu_${k}`] = recs.reduce((s, r) => s + num(r[`phu_${k}`]), 0);
  });
  return merged as InvoiceRecord;
}

/* ── Tính toán dùng chung cho preview & PDF ──
   Tổng (tác dụng) = BT+CĐ+TĐ; cosφ = Tổng cuối / √(Tổng cuối² + VC cuối²). */
function computeResults(d: Record<string, any>) {
  const hsnVal = num(d.HSN);
  const sanLuong: Record<string, number> = {};
  COMPONENTS.forEach(c => {
    sanLuong[c.key] = (num(d[`${c.key}_cuoi`]) - num(d[`${c.key}_dau`])) * hsnVal;
  });
  // Sản lượng thực tế = trực tiếp - phụ trừ, không cho âm (và tránh hiển thị -0)
  const cuoiOf = (k: string) => Math.max(0, sanLuong[k] - num(d[`phu_${k}`])) || 0;
  const slTong = sanLuong.BT + sanLuong.CD + sanLuong.TD;
  const tongCuoi = cuoiOf('BT') + cuoiOf('CD') + cuoiOf('TD');
  // Danh sách biểu hiển thị: Tổng (gộp) + BT/CĐ/TĐ/VC
  const bieu = [
    { key: 'Tong', label: 'Tổng', sanLuong: slTong, phu: 0, cuoi: tongCuoi },
    { key: 'BT', label: 'BT', sanLuong: sanLuong.BT, phu: num(d.phu_BT), cuoi: cuoiOf('BT') },
    { key: 'CD', label: 'CĐ', sanLuong: sanLuong.CD, phu: num(d.phu_CD), cuoi: cuoiOf('CD') },
    { key: 'TD', label: 'TĐ', sanLuong: sanLuong.TD, phu: num(d.phu_TD), cuoi: cuoiOf('TD') },
    { key: 'VC', label: 'VC', sanLuong: sanLuong.VC, phu: num(d.phu_VC), cuoi: cuoiOf('VC') },
  ];
  const bieuVC = cuoiOf('VC');
  const apparent = Math.sqrt(tongCuoi * tongCuoi + bieuVC * bieuVC);
  const cosphi = apparent > 0 ? tongCuoi / apparent : 0;
  return { sanLuong, bieu, cosphi };
}

export default function BillConfirmManager({ readOnly = false }: { readOnly?: boolean }) {
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Khối Vận hành (readOnly): chỉ thấy khách hàng thuộc KCN của tài khoản.
  const zoneLock = useMemo(
    () => (readOnly ? zoneFromArea(pb.authStore.model?.area) : ''),
    [readOnly],
  );

  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch] = useState('');
  // '' = chưa xác định; sẽ đặt = tháng có dữ liệu mới nhất khi mở trang
  const [monthFilterDate, setMonthFilterDate] = useState<string>('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  /* ── chọn nhiều biên bản để tải hàng loạt ── */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkExporting, setIsBulkExporting] = useState(false);

  /* ── HES: token + đồng bộ thời gian lấy chỉ số ── */
  const [hesAccount, setHesAccount] = useState<AccountHes | null>(null);
  const [isGettingToken, setIsGettingToken] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);

  const [exportingId, setExportingId] = useState<string | null>(null);
  const showToast = useCallback((message: string, t: ToastType = 'info') => {
    notify.show(t, TOAST_TITLE[t], message);
  }, []);

  /* ── load list ──
     Chỉ tải bản ghi của tháng đang lọc (server-side filter theo EndDate),
     tránh getFullList toàn bảng — không khả thi khi collection lên tới hàng triệu dòng. */
  const loadRecords = useCallback(async (ym: string) => {
    if (!ym) return;
    setLoadingList(true);
    try {
      const [y, m] = ym.split('-').map(Number);
      const start = `${ym}-01`;
      // Cận trên: đầu tháng kế tiếp (loại trừ) — PocketBase lưu date là chuỗi
      // "YYYY-MM-DD 00:00:00.000Z" nên dùng "<= ngày-cuối-tháng" sẽ bỏ sót bản ghi
      // chốt đúng ngày cuối tháng (so sánh chuỗi). Dùng "< đầu-tháng-sau" để bao trọn.
      const nextStart = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
      const list = await pb.collection('invoice').getFullList<InvoiceRecord>({
        // Bỏ công tơ thuộc hóa đơn phản kháng (VC) — không lập biên bản xác nhận chỉ số.
        filter: pb.filter('EndDate >= {:start} && EndDate < {:nextStart} && LoaiHD != "VC"', { start, nextStart }),
        sort: '-created',
        requestKey: null,
      });
      setRecords(list);
    } catch (err: any) {
      showToast(`Lỗi tải danh sách: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setLoadingList(false);
    }
  }, [showToast]);

  /* Mặc định = tháng có biên bản/hóa đơn MỚI NHẤT (bỏ hóa đơn VC, khớp bộ lọc danh
     sách bên dưới) thay vì tháng hiện tại — đầu tháng chưa có dữ liệu thì danh sách rỗng. */
  useEffect(() => {
    let alive = true;
    setLoadingList(true);
    fetchLatestInvoiceMonth('LoaiHD != "VC"').then(ym => {
      if (alive) setMonthFilterDate(ym || currentYearMonth());
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => { loadRecords(monthFilterDate); }, [loadRecords, monthFilterDate]);

  /* ── tài khoản HES (khối Kinh doanh không phân theo khu vực, lấy bản ghi đầu tiên) ── */
  useEffect(() => {
    pb.collection('AccountHes').getList<AccountHes>(1, 1)
      .then(res => setHesAccount(res.items[0] || null))
      .catch(() => {});
  }, []);

  const getToken = async () => {
    if (!hesAccount) { showToast('Không tìm thấy tài khoản HES.', 'error'); return; }
    setIsGettingToken(true);
    try {
      const res = await fetch(`/hes/api/Login?UserAccount=${hesAccount.Account}&Password=${hesAccount.Password}`);
      if (!res.ok) throw new Error('Lỗi kết nối API');
      const data = await res.json();
      if (data?.TOKEN) {
        const updated = await pb.collection('AccountHes').update(hesAccount.id, { Token: data.TOKEN });
        setHesAccount(updated as any);
        showToast('Lấy Token thành công!', 'success');
      } else {
        throw new Error('Không nhận được Token');
      }
    } catch (err: any) {
      showToast('Lỗi lấy Token: ' + err.message, 'error');
    } finally {
      setIsGettingToken(false);
    }
  };

  const handleDelete = async (row: BienBanRow) => {
    const r = row.data;
    const ok = await confirm({
      title: 'Xóa biên bản?',
      message: `Biên bản công tơ ${r.SCT || '—'}${row.merged ? ` (${row.ids.length} khoảng đổi giá)` : ''} sẽ bị xóa vĩnh viễn. Thao tác không thể hoàn tác.`,
      confirmLabel: 'Xóa',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      // Hóa đơn đổi giá tách nhiều bản ghi → xóa tất cả khoảng của biên bản
      await Promise.all(row.ids.map(id => pb.collection('invoice').delete(id)));
      // Hóa đơn không còn dòng chi tiết nào (mọi công tơ đã xóa) ⇒ xóa luôn hóa đơn gốc
      // `einvoice` (user chốt 01/10/2026), để nạp lại XML không vướng bản cũ.
      const billId = (r.BillId ?? '').toString().trim();
      let einvRemoved = false;
      if (billId && billId !== '0') {
        const left = await pb.collection('invoice').getList(1, 1, {
          filter: pb.filter('BillId = {:b}', { b: billId }), fields: 'id', requestKey: null,
        });
        if (left.totalItems === 0) {
          const einv = await pb.collection('einvoice').getList(1, 1, {
            filter: pb.filter('BillId = {:b}', { b: billId }), fields: 'id', requestKey: null,
          });
          if (einv.items[0]) {
            await pb.collection('einvoice').delete(einv.items[0].id);
            einvRemoved = true;
          }
        }
      }
      await loadRecords(monthFilterDate);
      showToast(einvRemoved ? 'Đã xóa biên bản và hóa đơn gốc (không còn công tơ nào)' : 'Đã xóa biên bản', 'success');
    } catch (err: any) {
      showToast(`Lỗi khi xóa: ${err?.data?.message || err?.message || ''}`, 'error');
    }
  };

  /* ── xuất PDF ── */
  const exportDocx = async (r: InvoiceRecord, exportKey: string) => {
    setExportingId(exportKey);
    try {
      const blob = await generateBbxnDocx(r);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BienBan_${(r.SCT || 'CT').replace(/[^\w]/g, '')}_${fmtDate(r.EndDate).replace(/\//g, '-')}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showToast(`Lỗi khi xuất Word: ${err?.message || ''}`, 'error');
    } finally {
      setExportingId(null);
    }
  };

  // Tháng đã được lọc ở server (loadRecords); ở đây chỉ còn lọc theo ô tìm kiếm khách hàng/SCT
  const filteredRecords = useMemo(() => {
    const base = zoneLock ? records.filter(r => zoneOf(r.MKHang || '') === zoneLock) : records;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(r =>
      (r.SCT || '').toLowerCase().includes(q) ||
      (r.NMua || '').toLowerCase().includes(q) ||
      (r.NBan || '').toLowerCase().includes(q),
    );
  }, [records, search, zoneLock]);

  /* ── Gộp các khoảng đổi giá thành 1 dòng biên bản liên tục.
        Ưu tiên gộp theo BillId (mã hóa đơn, từ XML/SOAP), kế đến IndexId (=MIN MHHDVu công
        tơ, luôn có khi BillId trống). Thiếu cả hai (dữ liệu cũ) → fallback nối các khoảng
        CHUNG RANH GIỚI NGÀY của cùng công tơ. Bản ghi không có SCT → đứng riêng. ── */
  const mergedRows = useMemo<BienBanRow[]>(() => {
    const rows: BienBanRow[] = [];
    const pushGroup = (key: string, recs: InvoiceRecord[]) => {
      if (!recs.length) return;
      const byEndDesc = [...recs].sort((a, b) => dateOnly(b.EndDate).localeCompare(dateOnly(a.EndDate)));
      rows.push({
        key,
        ids: recs.map(r => r.id),
        primary: byEndDesc[0],
        data: mergeBienBan(recs),
        merged: recs.length > 1,
      });
    };

    // Tách 3 nhóm: gộp được theo IndexId/BillId / nối ngày theo công tơ / đứng riêng
    const byId = new Map<string, InvoiceRecord[]>();
    const byMeter = new Map<string, InvoiceRecord[]>();
    const singles: InvoiceRecord[] = [];
    filteredRecords.forEach(r => {
      const billId = (r.BillId ?? '').toString().trim();
      const indexId = (r.IndexId ?? '').toString().trim();
      const sct = (r.SCT || '').trim();
      const uid = (billId && billId !== '0') ? `B:${billId}` : (indexId && indexId !== '0') ? `I:${indexId}` : '';
      if (uid) {
        const k = `${sct}|${uid}`;
        if (!byId.has(k)) byId.set(k, []);
        byId.get(k)!.push(r);
      } else if (sct) {
        if (!byMeter.has(sct)) byMeter.set(sct, []);
        byMeter.get(sct)!.push(r);
      } else {
        singles.push(r);
      }
    });

    byId.forEach((recs, key) => pushGroup(key, recs));

    // Fallback nối ngày cho bản ghi thiếu BillId
    byMeter.forEach(recs => {
      recs.sort((a, b) =>
        (dateOnly(a.StartDate) || dateOnly(a.EndDate)).localeCompare(dateOnly(b.StartDate) || dateOnly(b.EndDate)),
      );
      let chain: InvoiceRecord[] = [];
      let lastEnd = '';
      const flush = () => {
        if (chain.length) pushGroup(`${(chain[0].SCT || '').trim()}|${dateOnly(chain[0].StartDate) || dateOnly(chain[0].EndDate)}`, chain);
        chain = [];
      };
      recs.forEach(r => {
        const start = dateOnly(r.StartDate);
        if (chain.length && start && lastEnd && start === lastEnd) chain.push(r);
        else { flush(); chain = [r]; }
        lastEnd = dateOnly(r.EndDate);
      });
      flush();
    });

    singles.forEach(r => rows.push({ key: `__id:${r.id}`, ids: [r.id], primary: r, data: r, merged: false }));
    return rows;
  }, [filteredRecords]);

  /* ── Đồng bộ thời gian lấy chỉ số: gọi API HES (0h–23h59 ngày cuối kỳ),
     so khớp CHỈ SỐ TỔNG (BT+CĐ+TĐ) của biên bản với dữ liệu trả về, lấy mốc
     thời gian có tổng GẦN NHẤT rồi điền vào NKy. Dùng tổng vì nó tăng đơn điệu
     → mốc thời gian là DUY NHẤT; nếu so từng biểu thì biểu phẳng cả ngày (vd CĐ)
     sẽ khớp nhầm 00:00. Luôn gọi API kể cả khi đã có NKy (ghi đè). ── */
  const syncNKyTimes = async () => {
    const token = hesAccount?.Token;
    if (!token) { showToast('Chưa có Token HES — hãy bấm "Lấy Token" trước.', 'error'); return; }
    // B1: chỉ đồng bộ các công tơ đã được tích chọn
    const targets = mergedRows.filter(row => selectedIds.has(row.key));
    if (targets.length === 0) { showToast('Hãy tích chọn công tơ cần đồng bộ trước.', 'warning'); return; }
    setIsSyncing(true);
    setSyncProgress({ done: 0, total: targets.length });
    let updated = 0, notFound = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const row = targets[i];
        const r = row.data; // chỉ số đã gộp (cuối kỳ = khoảng muộn nhất)
        const day = dateOnly(r.EndDate);
        if (!r.SCT || !day) { notFound++; setSyncProgress({ done: i + 1, total: targets.length }); continue; }
        const start = toHesDateStr(day, '00', '00');
        const end = toHesDateStr(day, '23', '59');
        const url = `/hes/api/GetMeterDataByDate?MeterNo=${r.SCT}&StartDate=${start}&EndDate=${end}&Token=${token}`;
        const res = await fetch(url);
        if (!res.ok) { notFound++; setSyncProgress({ done: i + 1, total: targets.length }); continue; }
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) { notFound++; setSyncProgress({ done: i + 1, total: targets.length }); continue; }

        // Chỉ số tổng cuối kỳ của biên bản = BT + CĐ + TĐ (khớp ACTIVE_KW_INDICATE_TOTAL)
        const invTotal = num(r.BT_cuoi) + num(r.CD_cuoi) + num(r.TD_cuoi);
        let match: DataMetter | null = null;
        let bestDiff = Infinity;
        if (invTotal > 0) {
          for (const d of data as DataMetter[]) {
            const tot = parseFloat(d.ACTIVE_KW_INDICATE_TOTAL);
            if (!Number.isFinite(tot)) continue;
            const diff = Math.abs(tot - invTotal);
            if (diff < bestDiff) { bestDiff = diff; match = d; }
          }
        }
        // Chốt chỉ số luôn rơi đúng mốc 30′ → tổng khớp gần như tuyệt đối (diff ~0).
        // Chênh > 1 kWh coi như không khớp (dữ liệu khác ngày / công tơ reset).
        if (!match || bestDiff > 1) { notFound++; setSyncProgress({ done: i + 1, total: targets.length }); continue; }

        const dt = new Date(match.DATE_TIME);
        if (isNaN(dt.getTime())) { notFound++; setSyncProgress({ done: i + 1, total: targets.length }); continue; }
        const nKySentence = `${pad2(dt.getHours())} giờ ${pad2(dt.getMinutes())} phút ngày ${pad2(dt.getDate())} tháng ${pad2(dt.getMonth() + 1)} năm ${dt.getFullYear()}`;
        // Ghi NKy cho mọi khoảng của hóa đơn (kể cả khi đổi giá tách nhiều bản ghi)
        await Promise.all(row.ids.map(id => pb.collection('invoice').update(id, { NKy: nKySentence })));
        updated++;
        setSyncProgress({ done: i + 1, total: targets.length });
      }
      await loadRecords(monthFilterDate);

      if (targets.length > 0 && updated === 0) {
        showToast(`Không công tơ nào lấy được dữ liệu — Token HES có thể đã hết hạn, hãy bấm "Lấy Token" lại.`, 'error');
      } else {
        showToast(`Đồng bộ xong: ${updated} cập nhật, ${notFound} không khớp dữ liệu`, 'success');
      }
    } catch (err: any) {
      showToast(`Lỗi đồng bộ: ${err?.message || ''}`, 'error');
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  // Gom theo Tên khách hàng (NMua); mỗi nhóm sort theo ngày cuối kỳ giảm dần;
  // danh sách nhóm sắp xếp theo MKH (mã khách hàng)
  const groupedByCustomer = useMemo(() => {
    const map = new Map<string, BienBanRow[]>();
    mergedRows.forEach(row => {
      const name = (row.data.NMua || '').trim() || '(Chưa có tên khách hàng)';
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(row);
    });
    const groups = Array.from(map.entries()).map(([name, items]) => {
      const mkhList = Array.from(new Set(items.map(it => (it.data.MKHang || '').trim()).filter(Boolean)))
        .sort((x, y) => x.localeCompare(y, 'vi', { numeric: true }));
      const mkhSort = mkhList[0] || '';
      return {
        name,
        mkh: mkhList.join(', '),
        mkhSort,
        zone: zoneOf(mkhSort),
        items: items.sort((a, b) =>
          dateOnly(b.data.EndDate).localeCompare(dateOnly(a.data.EndDate))),
      };
    });
    // Sắp xếp theo MKH tăng dần (từ 001), so sánh số học để 001,002,…,010 đúng thứ tự
    groups.sort((a, b) =>
      a.mkhSort.localeCompare(b.mkhSort, 'vi', { numeric: true }) || a.name.localeCompare(b.name, 'vi'));
    return groups;
  }, [mergedRows]);

  const toggleGroup = (name: string) =>
    setExpandedGroups(prev => ({ ...prev, [name]: !prev[name] }));
  const expandAll = () =>
    setExpandedGroups(Object.fromEntries(groupedByCustomer.map(g => [g.name, true])));
  const collapseAll = () => setExpandedGroups({});

  /* ── chọn nhiều để tải hàng loạt (theo dòng biên bản đã gộp, không theo bản ghi gốc) ── */
  const toggleSelection = (key: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const toggleGroupSelection = (items: BienBanRow[]) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = items.every(it => next.has(it.key));
      items.forEach(it => allSelected ? next.delete(it.key) : next.add(it.key));
      return next;
    });
  const selectAllFiltered = () => setSelectedIds(new Set(mergedRows.map(r => r.key)));
  const deselectAll = () => setSelectedIds(new Set());

  /* ── tải hàng loạt: ghép nhiều biên bản Word đã chọn vào 1 file .zip ── */
  const bulkExportZip = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkExporting(true);
    try {
      const zip = new PizZip();
      const selectedRows = mergedRows.filter(row => selectedIds.has(row.key));
      const usedNames = new Set<string>();
      for (const row of selectedRows) {
        const r = row.data;
        const blob = await generateBbxnDocx(r);
        const buf = await blob.arrayBuffer();
        let fname = `BienBan_${(r.SCT || 'CT').replace(/[^\w]/g, '')}_${fmtDate(r.EndDate).replace(/\//g, '-')}.docx`;
        if (usedNames.has(fname)) fname = `BienBan_${(r.SCT || 'CT').replace(/[^\w]/g, '')}_${fmtDate(r.EndDate).replace(/\//g, '-')}_${row.key}.docx`;
        usedNames.add(fname);
        zip.file(fname, buf);
      }
      const zipBlob = zip.generate({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BienBan_${todayStr()}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showToast(`Lỗi khi tải hàng loạt: ${err?.message || ''}`, 'error');
    } finally {
      setIsBulkExporting(false);
    }
  };

  /* ===================== LIST VIEW ===================== */
  const renderList = () => (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Header */}
      <div className="vl-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-accent-soft rounded-2xl text-accent">
              <FileCheck2 className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-ink tracking-tight uppercase">Biên bản xác nhận chỉ số</h1>
          </div>
          <p className="text-sm text-soft max-w-2xl">
            {readOnly
              ? 'Xem và tải biên bản của khách hàng thuộc khu công nghiệp phụ trách.'
              : 'Dữ liệu lấy từ XML hóa đơn ở màn "Nạp dữ liệu" — không thêm hay sửa tay. Xem, tải Word hoặc xóa (xóa rồi nạp lại XML để sửa).'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto">
          {/* Month filter (bộ chọn tháng, mặc định tháng hiện tại) */}
          <MonthPicker
            value={monthFilterDate}
            onChange={setMonthFilterDate}
            className="w-full sm:w-[200px]"
          />
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm khách hàng, SCT..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-[var(--border)] bg-surface rounded text-dim text-sm focus:outline-none focus:ring-1 focus:ring-accent w-full sm:w-[260px]"
            />
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="vl-card p-4 md:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={expandAll} className="px-3 py-1.5 rounded text-xs font-bold text-soft border border-[var(--border)] hover:bg-subtle transition-colors">Mở tất cả</button>
          <button onClick={collapseAll} className="px-3 py-1.5 rounded text-xs font-bold text-soft border border-[var(--border)] hover:bg-subtle transition-colors">Thu tất cả</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!readOnly && (<>
          <button
            onClick={getToken}
            disabled={isGettingToken || !hesAccount}
            title={hesAccount?.Token ? `Token: ${hesAccount.Token.slice(0, 16)}…` : 'Chưa có token'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold text-soft border border-[var(--border)] hover:bg-subtle transition-colors disabled:opacity-50"
          >
            {isGettingToken ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
            {isGettingToken ? 'Đang lấy...' : 'Lấy Token'}
          </button>
          <button
            onClick={syncNKyTimes}
            disabled={isSyncing || !hesAccount?.Token || selectedIds.size === 0}
            title={selectedIds.size === 0 ? 'Hãy tích chọn công tơ cần đồng bộ' : `Đồng bộ ${selectedIds.size} công tơ đã chọn`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold text-white bg-accent hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
          >
            {isSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {isSyncing
              ? `Đang đồng bộ... ${syncProgress ? `${syncProgress.done}/${syncProgress.total}` : ''}`
              : `Đồng bộ thời gian lấy chỉ số${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
          </button>
          </>)}
          <button
            onClick={selectAllFiltered}
            disabled={filteredRecords.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold text-soft border border-[var(--border)] hover:bg-subtle transition-colors disabled:opacity-50"
          >
            <CheckSquare className="w-3.5 h-3.5" /> Chọn hết
          </button>
          <button
            onClick={deselectAll}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold text-soft border border-[var(--border)] hover:bg-subtle transition-colors disabled:opacity-50"
          >
            <Square className="w-3.5 h-3.5" /> Bỏ chọn {selectedIds.size > 0 && `(${selectedIds.size})`}
          </button>
          <button
            onClick={bulkExportZip}
            disabled={selectedIds.size === 0 || isBulkExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:bg-[var(--border-strong)]"
          >
            {isBulkExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
            {isBulkExporting ? 'Đang nén...' : `Tải hàng loạt${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
          </button>
        </div>
      </div>

      {/* Grouped accordion list */}
      {loadingList ? (
        <div className="vl-card py-16 text-center text-faint text-sm">Đang tải...</div>
      ) : groupedByCustomer.length === 0 ? (
        <div className="vl-card py-16 text-center text-faint">
          <div className="flex flex-col items-center justify-center">
            <FileSpreadsheet className="w-12 h-12 text-faint mb-3" />
            <p className="text-sm">{readOnly ? 'Không có biên bản nào khớp bộ lọc.' : 'Không có biên bản nào khớp bộ lọc. Nạp XML hóa đơn ở màn "Nạp dữ liệu".'}</p>
          </div>
        </div>
      ) : (
        <div className="vl-accordion">
          {groupedByCustomer.map(group => {
            const open = !!expandedGroups[group.name];
            const groupSelected = group.items.length > 0 && group.items.every(it => selectedIds.has(it.key));
            const zColor = zoneColor(group.mkhSort);
            const zLabel = ZONE_MAP[group.zone] || group.zone;
            return (
              <div
                key={group.name}
                className={`vl-accordion-item ${open ? 'is-open' : ''}`}
                style={{ borderLeft: `4px solid ${zColor}` }}
              >
                {/* Group header */}
                <div
                  onClick={() => toggleGroup(group.name)}
                  className="vl-accordion-header"
                >
                  <div className="p-2 rounded shadow-xs shrink-0" style={{ backgroundColor: `${zColor}1a`, color: zColor }}>
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold truncate">{group.name}</p>
                    <p className="text-[11px] font-semibold text-faint flex items-center gap-2 flex-wrap">
                      <span>{group.items.length} biên bản</span>
                      {group.mkh && (
                        <span className="px-1.5 py-0.5 rounded bg-accent-soft text-accent font-bold">MKH: {group.mkh}</span>
                      )}
                      {zLabel && (
                        <span className="px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: `${zColor}1a`, color: zColor }}>
                          {zLabel}
                        </span>
                      )}
                    </p>
                  </div>
                  <ChevronRight className="vl-accordion-chevron w-5 h-5" />
                  {/* Checkbox chọn tất cả công tơ trong nhóm — cuối cùng bên phải, chặn lan để không trigger thu/mở */}
                  <div onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={groupSelected}
                      onChange={() => toggleGroupSelection(group.items)}
                      className="w-4.5 h-4.5 rounded border-[var(--border-strong)] text-accent focus:ring-accent"
                    />
                  </div>
                </div>

                {/* Group body */}
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="overflow-hidden vl-accordion-body"
                    >
                      <div className="overflow-x-auto">
                        <table className="vl-table w-full text-left border-collapse min-w-[900px]">
                          <thead>
                            <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                              <th className="py-3 px-4">Số công tơ</th>
                              <th className="py-3 px-4">Kỳ</th>
                              <th className="py-3 px-4 text-right">Sản lượng Tổng</th>
                              <th className="py-3 px-4 text-center">Cosφ</th>
                              <th className="py-3 px-4 text-center">Thời gian lấy chỉ số</th>
                              <th className="py-3 px-4 text-center w-[200px]">Thao tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)]">
                            {group.items.map(row => {
                              const r = row.data;
                              const res = computeResults(r);
                              const isSelected = selectedIds.has(row.key);
                              return (
                                <tr key={row.key} className={`text-dim text-sm hover:bg-subtle/80 transition-colors ${isSelected ? 'bg-accent-soft' : ''}`}>
                                  <td className="py-3.5 px-4 font-mono font-bold text-accent">{r.SCT || '—'}</td>
                                  <td className="py-3.5 px-4 text-xs font-semibold text-soft">
                                    <div className="flex items-center gap-1.5">
                                      <span>{fmtDate(r.StartDate)} – {fmtDate(r.EndDate)}</span>
                                      {row.merged && (
                                        <span title={`Hóa đơn đổi giá — gộp ${row.ids.length} khoảng`}
                                          className="px-1.5 py-0.5 rounded bg-[var(--warning-soft)] text-warn text-[10px] font-bold uppercase tracking-wide">
                                          đổi giá điện
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4 text-right font-mono font-bold text-warn">{fmt(res.bieu[0].cuoi)}</td>
                                  <td className="py-3.5 px-4 text-center font-mono font-bold text-dim">{res.cosphi.toFixed(3)}</td>
                                  <td className="py-3.5 px-4 text-center text-xs font-mono tabular-nums">
                                    {fmtNKy(r.NKy)
                                      ? <span className="text-ok font-semibold">{fmtNKy(r.NKy)}</span>
                                      : <span className="text-faint">Chưa đồng bộ</span>}
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button onClick={() => exportDocx(r, row.key)} disabled={exportingId === row.key} title="Tải Word"
                                        className="p-2 rounded-lg text-soft hover:bg-[var(--success-soft)] hover:text-ok transition-colors disabled:opacity-50">
                                        <FileDown className="w-4 h-4" />
                                      </button>
                                      {!readOnly && (
                                        <button onClick={() => handleDelete(row)} title="Xóa"
                                          className="p-2 rounded-lg text-soft hover:bg-rose-50 hover:text-rose-600 transition-colors">
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      )}
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleSelection(row.key)}
                                        className="w-4.5 h-4.5 ml-1 rounded border-[var(--border-strong)] text-accent focus:ring-accent"
                                      />
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="relative">
      {renderList()}
      {confirmDialog}
    </div>
  );
}
