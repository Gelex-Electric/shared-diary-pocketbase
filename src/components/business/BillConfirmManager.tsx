import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { pb } from '../../lib/pocketbase';
import { DatePicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import pdfMake from 'pdfmake/build/pdfmake';
import {
  FileCheck2, Save, Calculator, Gauge, Hash, Building2,
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
    setNBan(''); setDChiNBan(''); setNMua(''); setDChiNMua(''); setSct(''); setHsn('1');
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
    setSct(r.SCT || ''); setHsn(String(r.HSN ?? ''));
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
        SCT: sct, HSN: num(hsn),
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

      const indexRows = COMPONENTS.map(c => ([
        { text: c.label, alignment: 'left' },
        { text: fmt(num(r[`${c.key}_dau`])), alignment: 'right' },
        { text: fmt(num(r[`${c.key}_cuoi`])), alignment: 'right' },
        { text: fmt(res.sanLuong[c.key]), alignment: 'right' },
      ]));

      const resultRows = res.bieu.map(b => ([
        { text: `Biểu ${b.label}`, alignment: 'left' },
        { text: fmt(b.sanLuong), alignment: 'right' },
        { text: fmt(b.phu), alignment: 'right' },
        { text: fmt(b.cuoi), alignment: 'right', bold: true },
      ]));

      const docDefinition: any = {
        pageSize: 'A4',
        pageMargins: [40, 36, 40, 36],
        defaultStyle: { font: 'Times', fontSize: 12, lineHeight: 1.3 },
        styles: {
          title: { fontSize: 15, bold: true, alignment: 'center' },
          sub: { fontSize: 12, bold: true, margin: [0, 10, 0, 4] },
          th: { bold: true, fillColor: '#f3f4f6', alignment: 'center' },
        },
        content: [
          { text: 'CÔNG TY GETC', alignment: 'center', bold: true },
          { text: 'BIÊN BẢN XÁC NHẬN CHỈ SỐ CÔNG TƠ', style: 'title', margin: [0, 6, 0, 2] },
          { text: `Kỳ: ${fmtDate(r.StartDate)} — ${fmtDate(r.EndDate)}`, alignment: 'center', italics: true, margin: [0, 0, 0, 8] },

          {
            columns: [
              { width: '50%', stack: [
                { text: 'Bên bán điện:', bold: true },
                { text: r.NBan || '—' },
                { text: r.DChiNBan || '', italics: true, fontSize: 11 },
              ] },
              { width: '50%', stack: [
                { text: 'Bên mua điện:', bold: true },
                { text: r.NMua || '—' },
                { text: r.DChiNMua || '', italics: true, fontSize: 11 },
              ] },
            ],
            columnGap: 16,
            margin: [0, 0, 0, 6],
          },
          { text: `Số công tơ (SCT): ${r.SCT || '—'}        Hệ số nhân (HSN): ${fmt(num(r.HSN), 4)}`, margin: [0, 0, 0, 4] },

          { text: 'I. CHỈ SỐ ĐẦU / CUỐI KỲ', style: 'sub' },
          {
            table: {
              headerRows: 1,
              widths: ['34%', '22%', '22%', '22%'],
              body: [
                [
                  { text: 'Thành phần', style: 'th' },
                  { text: 'Đầu kỳ', style: 'th' },
                  { text: 'Cuối kỳ', style: 'th' },
                  { text: 'Sản lượng', style: 'th' },
                ],
                ...indexRows,
              ],
            },
            layout: { hLineWidth: () => 0.8, vLineWidth: () => 0.8, hLineColor: () => '#9ca3af', vLineColor: () => '#9ca3af', paddingTop: () => 4, paddingBottom: () => 4 },
          },

          { text: 'II. SẢN LƯỢNG CUỐI CÙNG', style: 'sub' },
          {
            table: {
              headerRows: 1,
              widths: ['34%', '22%', '22%', '22%'],
              body: [
                [
                  { text: 'Biểu', style: 'th' },
                  { text: 'Sản lượng', style: 'th' },
                  { text: 'Biểu phụ', style: 'th' },
                  { text: 'Biểu cuối', style: 'th' },
                ],
                ...resultRows,
              ],
            },
            layout: { hLineWidth: () => 0.8, vLineWidth: () => 0.8, hLineColor: () => '#9ca3af', vLineColor: () => '#9ca3af', paddingTop: () => 4, paddingBottom: () => 4 },
          },

          { text: `Hệ số công suất cosφ = ${res.cosphi.toFixed(3)}`, bold: true, margin: [0, 10, 0, 0] },

          {
            columns: [
              { width: '50%', stack: [
                { text: 'ĐẠI DIỆN BÊN BÁN', bold: true, alignment: 'center', margin: [0, 24, 0, 40] },
                { text: '(Ký, ghi rõ họ tên)', italics: true, alignment: 'center', fontSize: 11 },
              ] },
              { width: '50%', stack: [
                { text: 'ĐẠI DIỆN BÊN MUA', bold: true, alignment: 'center', margin: [0, 24, 0, 40] },
                { text: '(Ký, ghi rõ họ tên)', italics: true, alignment: 'center', fontSize: 11 },
              ] },
            ],
            margin: [0, 20, 0, 0],
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
  const numCls = inputCls + ' text-right font-mono tabular-nums';
  const labelCls = 'block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5';

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

      {/* Thông tin chung */}
      <div className="vl-card p-6 md:p-8">
        <h3 className="text-base font-black text-slate-800 mb-5 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[#5a8dee]" /> Thông tin chung
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>Ngày đầu kỳ</label>
            <DatePicker value={startDate} onChange={setStartDate} />
          </div>
          <div>
            <label className={labelCls}>Ngày cuối kỳ</label>
            <DatePicker value={endDate} onChange={setEndDate} />
          </div>
          <div>
            <label className={labelCls}>Số công tơ (SCT)</label>
            <input className={inputCls} value={sct} onChange={e => setSct(e.target.value)} placeholder="Nhập số công tơ" />
          </div>
          <div>
            <label className={labelCls}>Hệ số nhân (HSN)</label>
            <input className={numCls} inputMode="decimal" value={hsn} onChange={e => setHsn(e.target.value)} placeholder="1" />
          </div>
          <div>
            <label className={labelCls}>Người bán (NBan)</label>
            <input className={inputCls} value={nBan} onChange={e => setNBan(e.target.value)} placeholder="Bên bán điện" />
          </div>
          <div>
            <label className={labelCls}>Địa chỉ người bán</label>
            <input className={inputCls} value={dChiNBan} onChange={e => setDChiNBan(e.target.value)} placeholder="Địa chỉ bên bán" />
          </div>
          <div>
            <label className={labelCls}>Người mua (NMua)</label>
            <input className={inputCls} value={nMua} onChange={e => setNMua(e.target.value)} placeholder="Bên mua điện" />
          </div>
          <div>
            <label className={labelCls}>Địa chỉ người mua</label>
            <input className={inputCls} value={dChiNMua} onChange={e => setDChiNMua(e.target.value)} placeholder="Địa chỉ bên mua" />
          </div>
        </div>
      </div>

      {/* Chỉ số đầu / cuối kỳ */}
      <div className="vl-card p-6 md:p-8">
        <h3 className="text-base font-black text-slate-800 mb-5 flex items-center gap-2">
          <Gauge className="w-5 h-5 text-[#5a8dee]" /> Chỉ số đầu / cuối kỳ
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[560px]">
            <thead>
              <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-3 w-[36%]">Thành phần</th>
                <th className="py-3 px-3 text-right">Chỉ số đầu kỳ</th>
                <th className="py-3 px-3 text-right">Chỉ số cuối kỳ</th>
                <th className="py-3 px-3 text-right w-[24%]">Sản lượng (× HSN)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {COMPONENTS.map(c => (
                <tr key={c.key}>
                  <td className="py-2.5 px-3 text-sm font-semibold text-slate-700">{c.label}</td>
                  <td className="py-2.5 px-3">
                    <input className={numCls} inputMode="decimal"
                      value={readings[`${c.key}_dau`] ?? ''}
                      onChange={e => setReading(`${c.key}_dau`, e.target.value)} placeholder="0" />
                  </td>
                  <td className="py-2.5 px-3">
                    <input className={numCls} inputMode="decimal"
                      value={readings[`${c.key}_cuoi`] ?? ''}
                      onChange={e => setReading(`${c.key}_cuoi`, e.target.value)} placeholder="0" />
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600 text-sm tabular-nums">
                    {fmt(calc.sanLuong[c.key] ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {calc.tongMismatch && (
          <p className="mt-3 text-xs font-semibold text-amber-600 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            Lưu ý: sản lượng Tổng (PG) = {fmt(calc.sanLuong.PG)} khác tổng BT+CD+TD = {fmt(calc.sumBtCdTd)}.
          </p>
        )}
      </div>

      {/* Biểu phụ + Kết quả */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="vl-card p-6 md:p-8">
          <h3 className="text-base font-black text-slate-800 mb-5 flex items-center gap-2">
            <Hash className="w-5 h-5 text-[#5a8dee]" /> Biểu phụ (trừ)
          </h3>
          <div className="space-y-3">
            {RESULTS.map(r => (
              <div key={r.key} className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-20 shrink-0">{r.label}</label>
                <input className={numCls} inputMode="decimal"
                  value={phu[r.key] ?? ''}
                  onChange={e => setPhuVal(r.key, e.target.value)} placeholder="0" />
              </div>
            ))}
          </div>
        </div>

        <div className="vl-card p-6 md:p-8 bg-gradient-to-br from-[#f4f8ff] to-white">
          <h3 className="text-base font-black text-slate-800 mb-5 flex items-center gap-2">
            <Calculator className="w-5 h-5 text-[#5a8dee]" /> Sản lượng cuối cùng
          </h3>
          <div className="space-y-2">
            {calc.bieu.map(b => (
              <div key={b.key} className="flex items-center justify-between border-b border-dashed border-slate-200 pb-2 last:border-b-0">
                <span className="text-sm font-bold text-slate-500">Biểu {b.label}</span>
                <span className="font-mono font-extrabold text-slate-800 text-sm tabular-nums">{fmt(b.cuoi)}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 p-4 rounded-2xl bg-[#5a8dee] text-white flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/80">Hệ số công suất</p>
              <p className="text-sm font-semibold text-white/90">Cosφ</p>
            </div>
            <span className="text-3xl font-black font-mono tabular-nums">{calc.cosphi.toFixed(3)}</span>
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
