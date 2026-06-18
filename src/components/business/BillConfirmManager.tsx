import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { pb } from '../../lib/pocketbase';
import { DatePicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import pdfMake from 'pdfmake/build/pdfmake';
import {
  FileCheck2, Save, Gauge, Building2,
  CheckCircle2, AlertCircle, RotateCcw, Plus, ArrowLeft,
  Pencil, Trash2, FileDown, Search, FileSpreadsheet,
} from 'lucide-react';

/* ============================================================
   Biên bản xác nhận chỉ số (collection PocketBase: BBXN)
   - Nhập chỉ số đầu/cuối kỳ 5 thành phần: PG, BT, CD, TD, VC
   - Sản lượng = (cuối - đầu) * HSN
   - Biểu cuối = sản lượng - biểu phụ
   - Cosφ = biểu Tổng / √(biểu Tổng² + biểu VC²)
   Chỉ dành cho khối Kinh doanh.
============================================================ */

type ToastType = 'success' | 'error' | 'warning' | 'info';

// 5 thành phần chỉ số. PG = tổng (tác dụng), VC = vô công (phản kháng).
const COMPONENTS = [
  { key: 'PG', label: 'PG — Tổng (tác dụng)' },
  { key: 'BT', label: 'BT — Bình thường' },
  { key: 'CD', label: 'CD — Cao điểm' },
  { key: 'TD', label: 'TD — Thấp điểm' },
  { key: 'VC', label: 'VC — Vô công (phản kháng)' },
] as const;

// 5 biểu kết quả (Tổng lấy từ PG)
const RESULTS = [
  { key: 'Tong', src: 'PG', label: 'Tổng' },
  { key: 'BT',   src: 'BT', label: 'BT' },
  { key: 'CD',   src: 'CD', label: 'CD' },
  { key: 'TD',   src: 'TD', label: 'TD' },
  { key: 'VC',   src: 'VC', label: 'VC' },
] as const;

// Hàng hiển thị trong bảng biên bản (theo đúng mẫu giấy)
const ROWS = [
  { comp: 'PG', res: 'Tong', label: 'Tổng Pg' },
  { comp: 'BT', res: 'BT',   label: 'BT' },
  { comp: 'CD', res: 'CD',   label: 'CĐ' },
  { comp: 'TD', res: 'TD',   label: 'TĐ' },
  { comp: 'VC', res: 'VC',   label: 'Tổng Qg' },
] as const;

interface BBXNRecord {
  id: string;
  StartDate: string;
  EndDate: string;
  NBan: string;
  DChiNBan: string;
  NMua: string;
  DChiNMua: string;
  SCT: string;
  HSN: number;
  [key: string]: any; // PG_dau, ..., phu_Tong, ...
  created: string;
  updated: string;
}

/* ── Font cho PDF (giống Sổ nhật ký vận hành) ── */
const timesUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Regular.ttf';
const timesBdUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Bold.ttf';
const timesBiUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-BoldItalic.ttf';
const timesIUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Italic.ttf';
let fontsLoaded = false;
const loadFontsToVfs = async () => {
  if (fontsLoaded) return;
  const entries: [string, string][] = [
    ['times.ttf', timesUrl],
    ['timesbd.ttf', timesBdUrl],
    ['timesbi.ttf', timesBiUrl],
    ['timesi.ttf', timesIUrl],
  ];
  await Promise.all(entries.map(async ([name, url]) => {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    (pdfMake as any).virtualfs.writeFileSync(name, new Uint8Array(buf));
  }));
  pdfMake.fonts = {
    Times: { normal: 'times.ttf', bold: 'timesbd.ttf', italics: 'timesi.ttf', bolditalics: 'timesbi.ttf' },
  };
  fontsLoaded = true;
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
const fmtDate = (s?: string) => {
  if (!s) return '—';
  const datePart = s.split('T')[0].split(' ')[0];
  const [y, m, d] = datePart.split('-');
  return d && m && y ? `${d}/${m}/${y}` : s;
};

/* ── Tính toán dùng chung cho preview & PDF ── */
function computeResults(d: Record<string, any>) {
  const hsnVal = num(d.HSN);
  const sanLuong: Record<string, number> = {};
  COMPONENTS.forEach(c => {
    sanLuong[c.key] = (num(d[`${c.key}_cuoi`]) - num(d[`${c.key}_dau`])) * hsnVal;
  });
  const bieu = RESULTS.map(r => {
    const sl = sanLuong[r.src] ?? 0;
    const phuVal = num(d[`phu_${r.key}`]);
    return { ...r, sanLuong: sl, phu: phuVal, cuoi: sl - phuVal };
  });
  const bieuTong = bieu.find(b => b.key === 'Tong')!.cuoi;
  const bieuVC = bieu.find(b => b.key === 'VC')!.cuoi;
  const apparent = Math.sqrt(bieuTong * bieuTong + bieuVC * bieuVC);
  const cosphi = apparent > 0 ? bieuTong / apparent : 0;
  const sumBtCdTd = sanLuong.BT + sanLuong.CD + sanLuong.TD;
  const tongMismatch = Math.abs(sanLuong.PG - sumBtCdTd) > 1;
  return { sanLuong, bieu, cosphi, tongMismatch, sumBtCdTd };
}

export default function BillConfirmManager() {
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [records, setRecords] = useState<BBXNRecord[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch] = useState('');

  /* ── form: meta ── */
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [nBan, setNBan] = useState('');
  const [dChiNBan, setDChiNBan] = useState('');
  const [nMua, setNMua] = useState('');
  const [dChiNMua, setDChiNMua] = useState('');
  const [sct, setSct] = useState('');
  const [hsn, setHsn] = useState('1');
  const [nKy, setNKy] = useState('');
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [phu, setPhu] = useState<Record<string, string>>({});

  const setReading = (k: string, v: string) => setReadings(prev => ({ ...prev, [k]: v }));
  const setPhuVal = (k: string, v: string) => setPhu(prev => ({ ...prev, [k]: v }));

  const [isSaving, setIsSaving] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const showToast = useCallback((message: string, t: ToastType = 'info') => {
    setToast({ message, type: t });
    setTimeout(() => setToast(null), 4000);
  }, []);

  /* ── load list ── */
  const loadRecords = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await pb.collection('BBXN').getFullList<BBXNRecord>({
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

  useEffect(() => { loadRecords(); }, [loadRecords]);

  /* ── form helpers ── */
  const resetForm = () => {
    setStartDate(todayStr()); setEndDate(todayStr());
    setNBan(''); setDChiNBan(''); setNMua(''); setDChiNMua(''); setSct(''); setHsn('1'); setNKy('');
    setReadings({}); setPhu({});
  };

  const openCreate = () => {
    resetForm();
    setEditingId(null);
    setView('form');
  };

  const openEdit = (r: BBXNRecord) => {
    setStartDate((r.StartDate || '').split('T')[0].split(' ')[0] || todayStr());
    setEndDate((r.EndDate || '').split('T')[0].split(' ')[0] || todayStr());
    setNBan(r.NBan || ''); setDChiNBan(r.DChiNBan || '');
    setNMua(r.NMua || ''); setDChiNMua(r.DChiNMua || '');
    setSct(r.SCT || ''); setHsn(String(r.HSN ?? '')); setNKy(r.NKy || '');
    const rd: Record<string, string> = {};
    COMPONENTS.forEach(c => {
      rd[`${c.key}_dau`] = r[`${c.key}_dau`] != null ? String(r[`${c.key}_dau`]) : '';
      rd[`${c.key}_cuoi`] = r[`${c.key}_cuoi`] != null ? String(r[`${c.key}_cuoi`]) : '';
    });
    setReadings(rd);
    const rp: Record<string, string> = {};
    RESULTS.forEach(res => { rp[res.key] = r[`phu_${res.key}`] != null ? String(r[`phu_${res.key}`]) : ''; });
    setPhu(rp);
    setEditingId(r.id);
    setView('form');
  };

  /* dữ liệu số để tính preview trong form */
  const formData = useMemo(() => {
    const d: Record<string, any> = { HSN: num(hsn) };
    COMPONENTS.forEach(c => {
      d[`${c.key}_dau`] = num(readings[`${c.key}_dau`]);
      d[`${c.key}_cuoi`] = num(readings[`${c.key}_cuoi`]);
    });
    RESULTS.forEach(r => { d[`phu_${r.key}`] = num(phu[r.key]); });
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
        NBan: nBan, DChiNBan: dChiNBan, NMua: nMua, DChiNMua: dChiNMua,
        SCT: sct, HSN: num(hsn), NKy: nKy,
        phu_Tong: num(phu.Tong), phu_BT: num(phu.BT), phu_CD: num(phu.CD),
        phu_TD: num(phu.TD), phu_VC: num(phu.VC),
      };
      COMPONENTS.forEach(c => {
        data[`${c.key}_dau`] = num(readings[`${c.key}_dau`]);
        data[`${c.key}_cuoi`] = num(readings[`${c.key}_cuoi`]);
      });

      if (editingId) {
        await pb.collection('BBXN').update(editingId, data);
        showToast('Đã cập nhật biên bản', 'success');
      } else {
        await pb.collection('BBXN').create(data);
        showToast('Đã lưu biên bản xác nhận chỉ số', 'success');
      }
      await loadRecords();
      setView('list');
      setEditingId(null);
    } catch (err: any) {
      showToast(`Lỗi khi lưu: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (r: BBXNRecord) => {
    const ok = await confirm({
      title: 'Xóa biên bản?',
      message: `Biên bản công tơ ${r.SCT || '—'} sẽ bị xóa vĩnh viễn. Thao tác không thể hoàn tác.`,
      confirmLabel: 'Xóa',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await pb.collection('BBXN').delete(r.id);
      await loadRecords();
      showToast('Đã xóa biên bản', 'success');
    } catch (err: any) {
      showToast(`Lỗi khi xóa: ${err?.data?.message || err?.message || ''}`, 'error');
    }
  };

  /* ── xuất PDF ── */
  const exportPdf = async (r: BBXNRecord) => {
    setExportingId(r.id);
    try {
      await loadFontsToVfs();
      const res = computeResults(r);

      const th = (text: string) => ({ text, bold: true, fillColor: '#dbeafe', alignment: 'center', fontSize: 9 });
      const numCell = (n: number, bold = false) => ({ text: fmt(n), alignment: 'right', bold, fontSize: 10 });

      // Bảng gộp giống biên bản giấy (SCT, HSN, cosφ là ô gộp dọc)
      const tableBody: any[] = [
        [
          { ...th('Số công tơ'), rowSpan: 2 },
          { ...th('Thanh ghi'), rowSpan: 2 },
          { ...th('Chỉ số công tơ'), colSpan: 2 }, {},
          { ...th('Hệ số nhân'), rowSpan: 2 },
          { ...th('Sản lượng (kWh)'), rowSpan: 2 },
          { ...th('Sản lượng trừ phụ (kWh)'), rowSpan: 2 },
          { ...th('Tổng sản lượng (kWh)'), rowSpan: 2 },
          { ...th('cosφ'), rowSpan: 2 },
        ],
        [ {}, {}, th('Đầu kỳ'), th('Cuối kỳ'), {}, {}, {}, {}, {} ],
      ];
      ROWS.forEach((row, i) => {
        const bieu = res.bieu.find(b => b.key === row.res)!;
        tableBody.push([
          i === 0 ? { text: r.SCT || '—', rowSpan: ROWS.length, alignment: 'center', bold: true, margin: [0, 16, 0, 0] } : {},
          { text: row.label, alignment: 'center', bold: true, fontSize: 10 },
          { text: fmt2(num(r[`${row.comp}_dau`])), alignment: 'right', fontSize: 10 },
          { text: fmt2(num(r[`${row.comp}_cuoi`])), alignment: 'right', fontSize: 10 },
          i === 0 ? { text: fmt(num(r.HSN)), rowSpan: ROWS.length, alignment: 'center', bold: true, margin: [0, 16, 0, 0] } : {},
          numCell(bieu.sanLuong),
          numCell(bieu.phu),
          numCell(bieu.cuoi, true),
          i === 0 ? { text: res.cosphi.toFixed(2), rowSpan: ROWS.length, alignment: 'center', bold: true, fontSize: 13, margin: [0, 16, 0, 0] } : {},
        ]);
      });

      const infoLine = (label: string, value: string, valueBold = false) => ({
        columns: [
          { width: 130, text: label, bold: false },
          { text: value || '', bold: valueBold },
        ],
        margin: [0, 0, 0, 2],
      });

      const docDefinition: any = {
        pageSize: 'A4',
        pageOrientation: 'landscape',
        pageMargins: [30, 28, 30, 28],
        defaultStyle: { font: 'Times', fontSize: 12, lineHeight: 1.25 },
        content: [
          { text: `Từ ngày ${fmtDate(r.StartDate)} đến ngày ${fmtDate(r.EndDate)}`, alignment: 'center', bold: true, margin: [0, 0, 0, 8] },

          infoLine('Bên bán điện:', r.NBan || '—', true),
          infoLine('Địa chỉ:', r.DChiNBan || ''),
          infoLine('Bên mua điện:', r.NMua || '—', true),
          infoLine('Địa chỉ sử dụng điện:', r.DChiNMua || ''),
          { text: 'Cùng nhau xác nhận chỉ số công tơ, sản lượng điện giao nhận giữa hai bên như sau:', margin: [0, 4, 0, 8] },

          {
            table: {
              headerRows: 2,
              widths: ['12%', '10%', '12%', '12%', '8%', '13%', '13%', '12%', '8%'],
              body: tableBody,
            },
            layout: {
              hLineWidth: () => 0.8, vLineWidth: () => 0.8,
              hLineColor: () => '#374151', vLineColor: () => '#374151',
              paddingTop: () => 4, paddingBottom: () => 4,
            },
          },

          ...(r.NKy ? [{ text: r.NKy, alignment: 'right', italics: true, margin: [0, 14, 0, 0] }] : []),

          {
            columns: [
              { width: '50%', stack: [
                { text: 'ĐẠI DIỆN BÊN BÁN', bold: true, alignment: 'center', margin: [0, 16, 0, 36] },
                { text: '(Ký, ghi rõ họ tên)', italics: true, alignment: 'center', fontSize: 11 },
              ] },
              { width: '50%', stack: [
                { text: 'ĐẠI DIỆN BÊN MUA', bold: true, alignment: 'center', margin: [0, 16, 0, 36] },
                { text: '(Ký, ghi rõ họ tên)', italics: true, alignment: 'center', fontSize: 11 },
              ] },
            ],
            margin: [0, 6, 0, 0],
          },
        ],
      };

      const fname = `BBXN_${(r.SCT || 'CT').replace(/[^\w]/g, '')}_${fmtDate(r.EndDate).replace(/\//g, '-')}.pdf`;
      pdfMake.createPdf(docDefinition).download(fname);
    } catch (err: any) {
      showToast(`Lỗi khi xuất PDF: ${err?.message || ''}`, 'error');
    } finally {
      setExportingId(null);
    }
  };

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(r =>
      (r.SCT || '').toLowerCase().includes(q) ||
      (r.NMua || '').toLowerCase().includes(q) ||
      (r.NBan || '').toLowerCase().includes(q)
    );
  }, [records, search]);

  /* ── style helpers ── */
  const inputCls =
    'w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-sm text-slate-700 ' +
    'focus:outline-none focus:ring-2 focus:ring-[#5a8dee] focus:border-[#5a8dee] transition-all';
  const labelCls = 'block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5';
  // input gọn nằm trong ô bảng (không viền riêng, dùng viền của ô)
  const cellInputCls =
    'w-full px-2 py-1.5 text-sm text-right font-mono tabular-nums bg-transparent outline-none ' +
    'rounded focus:bg-[#e8f3ff] transition-colors';
  const tdCls = 'border border-slate-300 px-1 py-0.5';
  const thCls = 'border border-slate-300 px-2 py-2 text-center font-bold';

  /* ===================== LIST VIEW ===================== */
  const renderList = () => (
    <div className="space-y-6 pb-12 animate-fade-in">
      <div className="vl-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-[#e8f3ff] rounded-2xl text-[#5a8dee]">
              <FileCheck2 className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Biên bản xác nhận chỉ số</h1>
          </div>
          <p className="text-sm text-slate-500 max-w-2xl">
            Danh sách biên bản đã lưu. Tạo mới, xem lại, chỉnh sửa, xóa hoặc tải PDF.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-[#5a8dee] hover:bg-[#4a7de2] shadow-sm transition-all shrink-0"
        >
          <Plus className="w-4 h-4" /> Tạo biên bản mới
        </button>
      </div>

      <div className="vl-card overflow-hidden">
        <div className="p-5 md:p-6 border-b border-slate-150 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
          <h3 className="text-base font-black text-slate-800">Danh sách biên bản ({records.length})</h3>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm SCT, bên mua/bán..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-slate-200 bg-white rounded text-slate-700 text-sm focus:outline-none focus:ring-1 focus:ring-[#5a8dee] w-full sm:w-[260px]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-4 px-4">Số công tơ</th>
                <th className="py-4 px-4">Kỳ</th>
                <th className="py-4 px-4">Bên mua</th>
                <th className="py-4 px-4 text-right">Sản lượng Tổng</th>
                <th className="py-4 px-4 text-center">Cosφ</th>
                <th className="py-4 px-4 text-center w-[160px]">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRecords.map(r => {
                const res = computeResults(r);
                return (
                  <tr key={r.id} className="text-slate-700 text-sm hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-[#5a8dee]">{r.SCT || '—'}</td>
                    <td className="py-3.5 px-4 text-xs font-semibold text-slate-500">
                      {fmtDate(r.StartDate)} – {fmtDate(r.EndDate)}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-800 max-w-[220px] truncate">{r.NMua || '—'}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-600">{fmt(res.bieu[0].cuoi)}</td>
                    <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-700">{res.cosphi.toFixed(3)}</td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openEdit(r)}
                          title="Sửa"
                          className="p-2 rounded-lg text-slate-500 hover:bg-[#e8f3ff] hover:text-[#5a8dee] transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => exportPdf(r)}
                          disabled={exportingId === r.id}
                          title="Tải PDF"
                          className="p-2 rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 transition-colors disabled:opacity-50"
                        >
                          <FileDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(r)}
                          title="Xóa"
                          className="p-2 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loadingList && filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <FileSpreadsheet className="w-12 h-12 text-slate-200 mb-3" />
                      <p className="text-sm">Chưa có biên bản nào. Nhấn "Tạo biên bản mới".</p>
                    </div>
                  </td>
                </tr>
              )}
              {loadingList && (
                <tr><td colSpan={6} className="py-16 text-center text-slate-400 text-sm">Đang tải...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  /* ===================== FORM VIEW ===================== */
  const renderForm = () => (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Header */}
      <div className="vl-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => { setView('list'); setEditingId(null); }}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              title="Quay lại danh sách"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="p-2.5 bg-[#e8f3ff] rounded-2xl text-[#5a8dee]">
              <FileCheck2 className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">
              {editingId ? 'Sửa biên bản' : 'Biên bản mới'}
            </h1>
          </div>
          <p className="text-sm text-slate-500 max-w-2xl">
            Nhập chỉ số đầu/cuối kỳ và hệ số nhân để tự động tính sản lượng, biểu cuối và cosφ.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={resetForm}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" /> Làm mới
          </button>
          <button
            onClick={save}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-[#5a8dee] hover:bg-[#4a7de2] disabled:opacity-60 shadow-sm transition-all"
          >
            <Save className="w-4 h-4" /> {isSaving ? 'Đang lưu...' : 'Lưu biên bản'}
          </button>
        </div>
      </div>

      {/* Thông tin đầu biên bản */}
      <div className="vl-card p-6 md:p-8">
        <h3 className="text-base font-black text-slate-800 mb-5 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[#5a8dee]" /> Thông tin biên bản
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
            <label className={labelCls}>Địa chỉ sử dụng điện</label>
            <input className={inputCls} value={dChiNMua} onChange={e => setDChiNMua(e.target.value)} placeholder="Địa chỉ sử dụng điện" />
          </div>
        </div>
      </div>

      {/* Bảng xác nhận chỉ số & sản lượng (giống biên bản giấy) */}
      <div className="vl-card p-4 md:p-6">
        <h3 className="text-base font-black text-slate-800 mb-2 flex items-center gap-2 px-2">
          <Gauge className="w-5 h-5 text-[#5a8dee]" /> Xác nhận chỉ số công tơ & sản lượng
        </h3>
        <p className="text-xs text-slate-500 mb-4 px-2">Cùng nhau xác nhận chỉ số công tơ, sản lượng điện giao nhận giữa hai bên như sau:</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-slate-700 min-w-[920px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
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
              {ROWS.map((row, i) => {
                const bieu = calc.bieu.find(b => b.key === row.res)!;
                return (
                  <tr key={row.comp}>
                    {i === 0 && (
                      <td className={tdCls + ' align-middle'} rowSpan={ROWS.length}>
                        <input
                          className={cellInputCls + ' text-center font-bold text-[#5a8dee]'}
                          value={sct}
                          onChange={e => setSct(e.target.value)}
                          placeholder="Số công tơ"
                        />
                      </td>
                    )}
                    <td className={tdCls + ' text-center font-bold text-slate-700'}>{row.label}</td>
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
                    {i === 0 && (
                      <td className={tdCls + ' align-middle'} rowSpan={ROWS.length}>
                        <input className={cellInputCls + ' text-center font-bold'} inputMode="decimal"
                          value={hsn} onChange={e => setHsn(e.target.value)} placeholder="1" />
                      </td>
                    )}
                    <td className={tdCls + ' text-right font-mono font-bold text-amber-600 pr-2'}>{fmt(bieu.sanLuong)}</td>
                    <td className={tdCls}>
                      <input className={cellInputCls} inputMode="decimal"
                        value={phu[row.res] ?? ''}
                        onChange={e => setPhuVal(row.res, e.target.value)} placeholder="0" />
                    </td>
                    <td className={tdCls + ' text-right font-mono font-extrabold text-slate-800 pr-2'}>{fmt(bieu.cuoi)}</td>
                    {i === 0 && (
                      <td className={tdCls + ' align-middle text-center'} rowSpan={ROWS.length}>
                        <span className="text-2xl font-black font-mono text-[#5a8dee]">{calc.cosphi.toFixed(2)}</span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {calc.tongMismatch && (
          <p className="mt-3 px-2 text-xs font-semibold text-amber-600 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            Lưu ý: sản lượng Tổng Pg = {fmt(calc.sanLuong.PG)} khác tổng BT+CĐ+TĐ = {fmt(calc.sumBtCdTd)}.
          </p>
        )}

        {/* Dòng ngày tháng cuối biên bản */}
        <div className="mt-5 px-2 flex flex-col sm:flex-row sm:justify-end">
          <div className="w-full sm:w-[460px]">
            <label className={labelCls}>Dòng ký cuối biên bản (NKy)</label>
            <input
              className={inputCls}
              value={nKy}
              onChange={e => setNKy(e.target.value)}
              placeholder="VD: 00 giờ 00 phút ngày 15 tháng 05 năm 2026"
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-24 right-6 z-[200] flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg ${
            toast.type === 'success' ? 'bg-emerald-600 text-white'
            : toast.type === 'error' ? 'bg-rose-600 text-white'
            : toast.type === 'warning' ? 'bg-amber-500 text-white'
            : 'bg-slate-700 text-white'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {view === 'list' ? renderList() : renderForm()}
      {confirmDialog}
    </div>
  );
}
