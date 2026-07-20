import { useMemo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { pb } from '../../lib/pocketbase';
import { DatePicker, TimePicker, MonthPicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import { generateBbxnDocx } from '../../lib/bbxnDocx';
import { AccountHes, DataMetter } from '../../types';
import { zoneFromArea, zoneOf, ZONE_MAP } from '../../lib/invoices';
import PizZip from 'pizzip';
import {
  FileCheck2, Save, Gauge, Building2, Users,
  RotateCcw, Plus, X, ChevronRight,
  Pencil, Trash2, FileDown, Search, FileSpreadsheet,
  CreditCard, RefreshCw, Zap, CheckSquare, Square, Archive,
} from 'lucide-react';

/* ============================================================
   Biên bản xác nhận chỉ số (collection PocketBase: invoice)
   - Nhập chỉ số đầu/cuối kỳ 5 thành phần: PG, BT, CD, TD, VC
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

// Hàng nhập trong bảng biên bản
const ROWS = [
  { comp: 'BT', res: 'BT', label: 'BT' },
  { comp: 'CD', res: 'CD', label: 'CĐ' },
  { comp: 'TD', res: 'TD', label: 'TĐ' },
  { comp: 'VC', res: 'VC', label: 'Tổng Qg' },
] as const;

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

// Dựng câu "NN giờ NN phút ngày NN tháng NN năm NNNN" từ ngày + giờ chọn
const buildNKySentence = (date: string, time: string): string => {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  const [hh, mi] = (time || '00:00').split(':');
  if (!y || !m || !d) return '';
  return `${pad2(Number(hh) || 0)} giờ ${pad2(Number(mi) || 0)} phút ngày ${pad2(Number(d))} tháng ${pad2(Number(m))} năm ${y}`;
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

// Chỉ số công tơ hiển thị tối đa 2 số lẻ (vd 6.829,33)
const fmt2 = (n: number) =>
  new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

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

// Màu phân biệt theo khu công nghiệp (dùng inline style — tránh Tailwind purge class động)
const ZONE_COLOR: Record<string, string> = {
  KCNTH: '#0ea5e9',  // sky
  KCNPĐ: '#10b981',  // emerald
  KCNTTI: '#8b5cf6', // violet
  KCNYM: '#f59e0b',  // amber
  KCN03: '#f43f5e',  // rose
};
const zoneColor = (mkh: string) => ZONE_COLOR[zoneOf(mkh)] || '#94a3b8';

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

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch] = useState('');
  const [monthFilterDate, setMonthFilterDate] = useState<string>(currentYearMonth());
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  /* ── chọn nhiều biên bản để tải hàng loạt ── */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkExporting, setIsBulkExporting] = useState(false);

  /* ── HES: token + đồng bộ thời gian lấy chỉ số ── */
  const [hesAccount, setHesAccount] = useState<AccountHes | null>(null);
  const [isGettingToken, setIsGettingToken] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);

  /* ── form: meta ── */
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [nBan, setNBan] = useState('');
  const [dChiNBan, setDChiNBan] = useState('');
  const [nMua, setNMua] = useState('');
  const [mKhang, setMKhang] = useState('');
  const [dChiNMua, setDChiNMua] = useState('');
  const [sct, setSct] = useState('');
  const [hsn, setHsn] = useState('1');
  const [nKyDate, setNKyDate] = useState('');
  const [nKyTime, setNKyTime] = useState('00:00');
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [phu, setPhu] = useState<Record<string, string>>({});

  const setReading = (k: string, v: string) => setReadings(prev => ({ ...prev, [k]: v }));
  const setPhuVal = (k: string, v: string) => setPhu(prev => ({ ...prev, [k]: v }));

  const [isSaving, setIsSaving] = useState(false);
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

  /* ── form helpers ── */
  const resetForm = () => {
    setStartDate(todayStr()); setEndDate(todayStr());
    setNBan(''); setDChiNBan(''); setNMua(''); setMKhang(''); setDChiNMua(''); setSct(''); setHsn('1');
    setNKyDate(''); setNKyTime('00:00');
    setReadings({}); setPhu({});
  };

  const openCreate = () => {
    resetForm();
    setEditingId(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
  };

  const openEdit = (r: InvoiceRecord) => {
    setStartDate((r.StartDate || '').split('T')[0].split(' ')[0] || todayStr());
    setEndDate((r.EndDate || '').split('T')[0].split(' ')[0] || todayStr());
    setNBan(r.NBan || ''); setDChiNBan(r.DChiNBan || '');
    setNMua(r.NMua || ''); setMKhang(r.MKHang || ''); setDChiNMua(r.DChiNMua || '');
    setSct(r.SCT || ''); setHsn(String(r.HSN ?? ''));
    const parsedNKy = parseNKySentence(r.NKy);
    setNKyDate(parsedNKy.date); setNKyTime(parsedNKy.time);
    const rd: Record<string, string> = {};
    COMPONENTS.forEach(c => {
      rd[`${c.key}_dau`] = r[`${c.key}_dau`] != null ? String(r[`${c.key}_dau`]) : '';
      rd[`${c.key}_cuoi`] = r[`${c.key}_cuoi`] != null ? String(r[`${c.key}_cuoi`]) : '';
    });
    setReadings(rd);
    const rp: Record<string, string> = {};
    PHU_KEYS.forEach(k => { rp[k] = r[`phu_${k}`] != null ? String(r[`phu_${k}`]) : ''; });
    setPhu(rp);
    setEditingId(r.id);
    setIsModalOpen(true);
  };

  /* dữ liệu số để tính preview trong form */
  const formData = useMemo(() => {
    const d: Record<string, any> = { HSN: num(hsn) };
    COMPONENTS.forEach(c => {
      d[`${c.key}_dau`] = num(readings[`${c.key}_dau`]);
      d[`${c.key}_cuoi`] = num(readings[`${c.key}_cuoi`]);
    });
    PHU_KEYS.forEach(k => { d[`phu_${k}`] = num(phu[k]); });
    return d;
  }, [hsn, readings, phu]);

  const calc = useMemo(() => computeResults(formData), [formData]);

  const save = async () => {
    if (isSaving) return;
    if (!sct.trim()) { showToast('Vui lòng nhập Số công tơ (SCT)', 'warning'); return; }
    if (num(hsn) <= 0) { showToast('Hệ số nhân (HSN) phải lớn hơn 0', 'warning'); return; }

    setIsSaving(true);
    try {
      const data: Record<string, any> = {
        StartDate: startDate,
        EndDate: endDate,
        NBan: nBan, DChiNBan: dChiNBan, NMua: nMua, DChiNMua: dChiNMua, MKHang: mKhang,
        SCT: sct, HSN: num(hsn), NKy: buildNKySentence(nKyDate, nKyTime),
        phu_BT: num(phu.BT), phu_CD: num(phu.CD),
        phu_TD: num(phu.TD), phu_VC: num(phu.VC),
      };
      COMPONENTS.forEach(c => {
        data[`${c.key}_dau`] = num(readings[`${c.key}_dau`]);
        data[`${c.key}_cuoi`] = num(readings[`${c.key}_cuoi`]);
      });

      if (editingId) {
        await pb.collection('invoice').update(editingId, data);
        showToast('Đã cập nhật biên bản', 'success');
      } else {
        await pb.collection('invoice').create(data);
        showToast('Đã lưu biên bản xác nhận chỉ số', 'success');
      }
      await loadRecords(monthFilterDate);
      closeModal();
    } catch (err: any) {
      showToast(`Lỗi khi lưu: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setIsSaving(false);
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
      await loadRecords(monthFilterDate);
      showToast('Đã xóa biên bản', 'success');
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

  /* ── style helpers ── */
  const inputCls =
    'w-full px-3 py-2 border border-[var(--border)] bg-surface rounded-lg text-sm text-dim ' +
    'focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all';
  const labelCls = 'block text-[11px] font-bold text-faint uppercase tracking-wider mb-1.5';
  // input gọn nằm trong ô bảng (không viền riêng, dùng viền của ô)
  const cellInputCls =
    'w-full px-2 py-1.5 text-sm text-center font-mono tabular-nums bg-transparent outline-none ' +
    'rounded focus:bg-accent-soft transition-colors';
  const tdCls = 'border border-[var(--border-strong)] px-1 py-1';
  const thCls = 'border border-[var(--border-strong)] px-2 py-2 text-center font-bold align-middle';
  // ô số tính sẵn — căn giữa, đồng bộ cỡ chữ
  const calcCell = tdCls + ' text-center font-mono text-sm tabular-nums';

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
              : 'Lưu theo từng khách hàng. Tạo mới, xem lại, chỉnh sửa, xóa hoặc tải PDF.'}
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
          {!readOnly && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-accent hover:bg-[var(--accent-hover)] shadow-sm transition-all shrink-0"
            >
              <Plus className="w-4 h-4" /> Tạo biên bản mới
            </button>
          )}
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
            <p className="text-sm">{readOnly ? 'Không có biên bản nào khớp bộ lọc.' : 'Không có biên bản nào khớp bộ lọc. Nhấn "Tạo biên bản mới".'}</p>
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
                                      {/* Hóa đơn đổi giá (gộp nhiều khoảng) không sửa tay được — ẩn nút Sửa */}
                                      {!readOnly && !row.merged && (
                                        <button onClick={() => openEdit(row.primary)} title="Sửa"
                                          className="p-2 rounded-lg text-soft hover:bg-accent-soft hover:text-accent transition-colors">
                                          <Pencil className="w-4 h-4" />
                                        </button>
                                      )}
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

  /* ===================== FORM MODAL ===================== */
  const renderModal = () => (
    <AnimatePresence>
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-start md:items-center justify-center p-4 overflow-y-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={closeModal}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          {/* Modal */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full max-w-5xl max-h-[90vh] my-4 flex flex-col bg-surface rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Modal header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)] bg-subtle/60 shrink-0">
              <div className="p-2 bg-accent-soft rounded-xl text-accent">
                <FileCheck2 className="w-5 h-5" />
              </div>
              <h3 className="flex-1 text-lg font-black text-ink tracking-tight">
                {editingId ? 'Sửa biên bản' : 'Tạo biên bản mới'}
              </h3>
              <button onClick={closeModal} className="p-2 rounded-lg text-faint hover:bg-subtle hover:text-dim transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
      {/* Thông tin đầu biên bản */}
      <div className="vl-card p-6 md:p-8">
        <h3 className="text-base font-black text-ink mb-5 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-accent" /> Thông tin biên bản
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Từ ngày</label>
            <DatePicker value={startDate} onChange={setStartDate} />
          </div>
          <div>
            <label className={labelCls}>Đến ngày</label>
            <DatePicker value={endDate} onChange={setEndDate} />
          </div>
          <div>
            <label className={labelCls}>Bên bán điện (NBan)</label>
            <input className={inputCls} value={nBan} onChange={e => setNBan(e.target.value)} placeholder="VD: CÔNG TY CỔ PHẦN MUA BÁN ĐIỆN GELEX" />
          </div>
          <div>
            <label className={labelCls}>Địa chỉ bên bán</label>
            <input className={inputCls} value={dChiNBan} onChange={e => setDChiNBan(e.target.value)} placeholder="Địa chỉ bên bán" />
          </div>
          <div>
            <label className={labelCls}>Bên mua điện (NMua)</label>
            <input className={inputCls} value={nMua} onChange={e => setNMua(e.target.value)} placeholder="VD: CÔNG TY TNHH HUM&C VINA" />
          </div>
          <div>
            <label className={labelCls}>Mã khách hàng (MKHang)</label>
            <input className={inputCls} value={mKhang} onChange={e => setMKhang(e.target.value)} placeholder="VD: KCN03-005" />
          </div>
          <div>
            <label className={labelCls}>Địa chỉ sử dụng điện</label>
            <input className={inputCls} value={dChiNMua} onChange={e => setDChiNMua(e.target.value)} placeholder="Địa chỉ sử dụng điện" />
          </div>
        </div>
      </div>

      {/* Bảng xác nhận chỉ số & sản lượng (giống biên bản giấy) */}
      <div className="vl-card p-4 md:p-6">
        <h3 className="text-base font-black text-ink mb-2 flex items-center gap-2 px-2">
          <Gauge className="w-5 h-5 text-accent" /> Xác nhận chỉ số công tơ & sản lượng
        </h3>
        <p className="text-xs text-soft mb-4 px-2">Cùng nhau xác nhận chỉ số công tơ, sản lượng điện giao nhận giữa hai bên như sau:</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-dim min-w-[920px]">
            <thead className="bg-subtle text-[11px] text-soft uppercase">
              <tr>
                <th className={thCls} rowSpan={2}>Số công tơ</th>
                <th className={thCls} rowSpan={2}>Thanh ghi</th>
                <th className={thCls} colSpan={2}>Chỉ số công tơ</th>
                <th className={thCls} rowSpan={2}>Hệ số<br />nhân</th>
                <th className={thCls} rowSpan={2}>Sản lượng<br />(kWh)</th>
                <th className={thCls} rowSpan={2}>Sản lượng<br />trừ phụ (kWh)</th>
                <th className={thCls} rowSpan={2}>Tổng sản<br />lượng (kWh)</th>
                <th className={thCls} rowSpan={2}>cosφ</th>
              </tr>
              <tr>
                <th className={thCls}>Đầu kỳ</th>
                <th className={thCls}>Cuối kỳ</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {(() => {
                const totalRows = ROWS.length + 1; // Tổng Pg + BT/CĐ/TĐ/Tổng Qg
                const sum3 = (suf: string) =>
                  num(readings[`BT_${suf}`]) + num(readings[`CD_${suf}`]) + num(readings[`TD_${suf}`]);
                const tongB = calc.bieu.find(b => b.key === 'Tong')!;
                const phuTong = num(phu.BT) + num(phu.CD) + num(phu.TD);
                return (
                  <>
                    {/* Hàng Tổng Pg (tính sẵn) + các ô gộp dọc SCT/HSN/cosφ */}
                    <tr>
                      <td className={tdCls + ' align-middle'} rowSpan={totalRows}>
                        <input
                          className={cellInputCls + ' font-bold text-accent'}
                          value={sct}
                          onChange={e => setSct(e.target.value)}
                          placeholder="Số công tơ"
                        />
                      </td>
                      <td className={tdCls + ' text-center font-bold text-dim'}>Tổng Pg</td>
                      <td className={calcCell + ' text-soft'}>{fmt2(sum3('dau'))}</td>
                      <td className={calcCell + ' text-soft'}>{fmt2(sum3('cuoi'))}</td>
                      <td className={tdCls + ' align-middle'} rowSpan={totalRows}>
                        <input className={cellInputCls + ' font-bold'} inputMode="decimal"
                          value={hsn} onChange={e => setHsn(e.target.value)} placeholder="1" />
                      </td>
                      <td className={calcCell + ' font-bold text-warn'}>{fmt(tongB.sanLuong)}</td>
                      <td className={calcCell}>{fmt(phuTong)}</td>
                      <td className={calcCell + ' font-extrabold text-ink'}>{fmt(tongB.cuoi)}</td>
                      <td className={tdCls + ' align-middle text-center'} rowSpan={totalRows}>
                        <span className="text-base font-black font-mono text-accent">{calc.cosphi.toFixed(2)}</span>
                      </td>
                    </tr>

                    {/* Các hàng nhập: BT, CĐ, TĐ, Tổng Qg */}
                    {ROWS.map(row => {
                      const bieu = calc.bieu.find(b => b.key === row.res)!;
                      return (
                        <tr key={row.comp}>
                          <td className={tdCls + ' text-center font-bold text-dim'}>{row.label}</td>
                          <td className={tdCls}>
                            <input className={cellInputCls} inputMode="decimal"
                              value={readings[`${row.comp}_dau`] ?? ''}
                              onChange={e => setReading(`${row.comp}_dau`, e.target.value)} placeholder="0" />
                          </td>
                          <td className={tdCls}>
                            <input className={cellInputCls} inputMode="decimal"
                              value={readings[`${row.comp}_cuoi`] ?? ''}
                              onChange={e => setReading(`${row.comp}_cuoi`, e.target.value)} placeholder="0" />
                          </td>
                          <td className={calcCell + ' font-bold text-warn'}>{fmt(bieu.sanLuong)}</td>
                          <td className={tdCls}>
                            <input className={cellInputCls} inputMode="decimal"
                              value={phu[row.res] ?? ''}
                              onChange={e => setPhuVal(row.res, e.target.value)} placeholder="0" />
                          </td>
                          <td className={calcCell + ' font-extrabold text-ink'}>{fmt(bieu.cuoi)}</td>
                        </tr>
                      );
                    })}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>

        {/* Dòng ngày tháng cuối biên bản */}
        <div className="mt-5 px-2 flex flex-col sm:flex-row sm:justify-end">
          <div className="w-full sm:w-[460px]">
            <label className={labelCls}>Dòng ký cuối biên bản (NKy)</label>
            <div className="flex gap-3">
              <DatePicker value={nKyDate} onChange={setNKyDate} className="flex-1" />
              <TimePicker value={nKyTime} onChange={setNKyTime} className="flex-1" />
            </div>
            {nKyDate && (
              <p className="mt-1.5 text-xs text-faint italic">{buildNKySentence(nKyDate, nKyTime)}</p>
            )}
          </div>
        </div>
      </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)] bg-subtle/60 shrink-0">
              <button
                onClick={resetForm}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold text-soft border border-[var(--border)] hover:bg-subtle transition-colors"
              >
                <RotateCcw className="w-4 h-4" /> Làm mới
              </button>
              <button
                onClick={closeModal}
                className="px-4 py-2.5 rounded-lg text-sm font-bold text-dim border border-[var(--border)] hover:bg-subtle transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={save}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-accent hover:bg-[var(--accent-hover)] disabled:opacity-60 shadow-sm transition-all"
              >
                <Save className="w-4 h-4" /> {isSaving ? 'Đang lưu...' : 'Lưu biên bản'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative">
      {renderList()}
      {renderModal()}
      {confirmDialog}
    </div>
  );
}
