import React, { useMemo, useState, useCallback } from 'react';
import { pb } from '../../lib/pocketbase';
import { useConfirm } from '../ui/ConfirmDialog';
import { parseInvoiceXml, type ParsedInvoice, type MeterPeriodRow, type Bieu } from '../../lib/parseInvoiceXml';
import { fetchAllInvoiceXml, type FetchProgress } from '../../lib/ccisApi';
import { MonthPicker } from '../ui/DateTimePickers';
import {
  Upload, FileCode2, Database, CheckCircle2, AlertCircle, Trash2,
  Users, Loader2, FileSpreadsheet, CloudDownload, Check,
} from 'lucide-react';

/* ============================================================
   Nạp dữ liệu nhanh — tải nhiều XML hóa đơn điện, xem trước,
   ghi hàng loạt vào collection `invoice`.
   Chỉ dành cho khối Kinh doanh.
============================================================ */

const INVOICE_COLLECTION = 'invoice';

type ToastType = 'success' | 'error' | 'warning' | 'info';

const ACTIVE_BIEU: Bieu[] = ['BT', 'CD', 'TD'];
const BIEU_LABEL: Record<Bieu, string> = { BT: 'BT', CD: 'CĐ', TD: 'TĐ', VC: 'VC' };

const fmt = (n: number, d = 0) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(n);
const fmt2 = (n: number) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n);
const fmtDate = (s: string) => {
  const [y, m, d] = (s || '').split('-');
  return d && m && y ? `${d}/${m}/${y}` : s || '—';
};

// điện trực tiếp = (mới - cũ) × HSN ; thực tế = trực tiếp - phụ trừ
const trucTiep = (row: MeterPeriodRow, b: Bieu) =>
  (row.bieu[b].moi - row.bieu[b].old) * row.HSN;
const thucTe = (row: MeterPeriodRow, b: Bieu) =>
  trucTiep(row, b) - row.bieu[b].phuTru;
// thành tiền hữu công (trước thuế) = Σ thực tế × đơn giá của BT/CĐ/TĐ
const thanhTienHC = (row: MeterPeriodRow) =>
  ACTIVE_BIEU.reduce((s, b) => s + thucTe(row, b) * row.bieu[b].dgia, 0);

interface FileEntry {
  fileName: string;
  invoice: ParsedInvoice;
}
// 1 dòng xem trước = 1 công tơ/khoảng, kèm meta hóa đơn
interface PreviewRow {
  id: string; // fileName|SCT|start|end
  fileName: string;
  invoice: ParsedInvoice;
  row: MeterPeriodRow;
}

/* Thanh tiến trình dạng stepper ngang (giống quy trình các bước) cho việc lấy hóa đơn. */
const FETCH_STEPS: { phase: FetchProgress['phase']; label: string }[] = [
  { phase: 'books', label: 'Quét sổ' },
  { phase: 'bills', label: 'Quét hóa đơn' },
  { phase: 'xml', label: 'Tải XML' },
  { phase: 'done', label: 'Hoàn tất' },
];

function FetchStepper({ progress }: { progress: FetchProgress }) {
  const current = FETCH_STEPS.findIndex(s => s.phase === progress.phase);
  return (
    <div className="mt-6 px-1">
      <div className="flex items-start">
        {FETCH_STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          const isLast = i === FETCH_STEPS.length - 1;
          const showCount = active && step.phase !== 'done' && progress.total > 0;
          return (
            <div key={step.phase} className="flex-1 flex flex-col items-center relative">
              {/* Đường nối sang bước kế */}
              {!isLast && (
                <div className="absolute top-4 left-1/2 w-full h-[3px] rounded-full overflow-hidden bg-slate-200">
                  <div
                    className={`h-full bg-[#7c3aed] transition-all duration-300 ${done ? 'w-full' : 'w-0'}`}
                  />
                </div>
              )}
              {/* Vòng tròn bước */}
              <div
                className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all duration-300 ${
                  done
                    ? 'bg-[#7c3aed] text-white shadow-md shadow-violet-300/50'
                    : active
                    ? 'bg-[#7c3aed] text-white shadow-md shadow-violet-300/50 ring-4 ring-violet-100'
                    : 'bg-white text-slate-400 border-2 border-slate-200'
                }`}
              >
                {done ? (
                  <Check className="w-4 h-4" strokeWidth={3} />
                ) : active && step.phase !== 'done' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  String(i + 1).padStart(2, '0')
                )}
              </div>
              {/* Nhãn */}
              <div className="mt-2 text-center px-1">
                <div className={`text-[11px] font-bold ${active || done ? 'text-slate-700' : 'text-slate-400'}`}>
                  {step.label}
                </div>
                {showCount && (
                  <div className="text-[10px] font-mono font-bold text-[#7c3aed] mt-0.5">
                    {progress.done}/{progress.total}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {progress.label && progress.phase !== 'done' && (
        <div className="mt-3 text-center text-[11px] font-semibold text-slate-400 truncate">
          {progress.label}
        </div>
      )}
    </div>
  );
}

export default function QuickImportManager() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const now = new Date();
  const [fetchYM, setFetchYM] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  ); // "YYYY-MM"
  const [fetchTerm, setFetchTerm] = useState(1); // kỳ 1/2/3
  const [isFetching, setIsFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<FetchProgress | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const showToast = useCallback((message: string, t: ToastType = 'info') => {
    setToast({ message, type: t });
    setTimeout(() => setToast(null), 4500);
  }, []);

  const previewRows = useMemo<PreviewRow[]>(() => {
    const out: PreviewRow[] = [];
    files.forEach(f => {
      f.invoice.rows.forEach(r => {
        out.push({
          id: `${f.fileName}|${r.SCT}|${r.StartDate}|${r.EndDate}`,
          fileName: f.fileName,
          invoice: f.invoice,
          row: r,
        });
      });
    });
    return out;
  }, [files]);

  // Gom xem trước theo khách hàng (NMua)
  const grouped = useMemo(() => {
    const map = new Map<string, PreviewRow[]>();
    previewRows.forEach(p => {
      const name = (p.invoice.nmua.ten || '').trim() || '(Không tên)';
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(p);
    });
    return Array.from(map.entries()).map(([name, rows]) => ({ name, rows }));
  }, [previewRows]);

  const selectedCount = useMemo(
    () => previewRows.filter(p => selected[p.id]).length,
    [previewRows, selected],
  );

  // Parse danh sách XML (từ file upload hoặc từ web service) rồi gộp vào danh sách xem trước.
  const ingestXml = (list: { fileName: string; xml: string }[]): { ok: number; errors: string[] } => {
    const parsed: FileEntry[] = [];
    const errors: string[] = [];
    for (const { fileName, xml } of list) {
      try {
        parsed.push({ fileName, invoice: parseInvoiceXml(xml) });
      } catch (err: any) {
        errors.push(`${fileName}: ${err?.message || 'lỗi đọc'}`);
      }
    }
    if (parsed.length > 0) {
      setFiles(prev => {
        const names = new Set(prev.map(p => p.fileName));
        return [...prev, ...parsed.filter(p => !names.has(p.fileName))];
      });
      setSelected(prev => {
        const next = { ...prev };
        parsed.forEach(f => f.invoice.rows.forEach(r => {
          next[`${f.fileName}|${r.SCT}|${r.StartDate}|${r.EndDate}`] = true;
        }));
        return next;
      });
    }
    return { ok: parsed.length, errors };
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const list: { fileName: string; xml: string }[] = [];
    for (const file of Array.from(fileList)) {
      list.push({ fileName: file.name, xml: await file.text() });
    }
    const { ok, errors } = ingestXml(list);
    if (errors.length) showToast(`Không đọc được ${errors.length} file: ${errors[0]}`, 'warning');
    else if (ok) showToast(`Đã đọc ${ok} file`, 'success');
  };

  // Lấy thẳng XML hóa đơn từ web service HĐĐT theo tháng/năm (không cần tải file).
  const handleFetch = async () => {
    if (isFetching) return;
    const [yStr, mStr] = fetchYM.split('-');
    const fetchYear = Number(yStr);
    const fetchMonth = Number(mStr);
    if (!fetchYear || !fetchMonth) { showToast('Chưa chọn kỳ/tháng', 'warning'); return; }
    setIsFetching(true);
    setFetchProgress({ phase: 'books', done: 0, total: 1, label: 'Bắt đầu…' });
    try {
      const { items, errors } = await fetchAllInvoiceXml(fetchYear, fetchMonth, fetchTerm, setFetchProgress);
      if (items.length === 0) {
        showToast(`Không lấy được hóa đơn nào cho kỳ ${fetchTerm} tháng ${fetchMonth}/${fetchYear}` + (errors.length ? ` (${errors[0]})` : ''), 'warning');
      } else {
        const { ok, errors: parseErrs } = ingestXml(items);
        const allErr = errors.length + parseErrs.length;
        showToast(
          `Đã lấy ${ok}/${items.length} hóa đơn kỳ ${fetchTerm} tháng ${fetchMonth}/${fetchYear}` + (allErr ? `, ${allErr} lỗi` : ''),
          allErr ? 'warning' : 'success',
        );
      }
    } catch (err: any) {
      showToast(`Lỗi lấy dữ liệu: ${err?.message || ''}`, 'error');
    } finally {
      setIsFetching(false);
      setFetchProgress(null);
    }
  };

  const clearAll = () => { setFiles([]); setSelected({}); };

  const toggleRow = (id: string) =>
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  const setAll = (val: boolean) =>
    setSelected(Object.fromEntries(previewRows.map(p => [p.id, val])));

  // Tạo payload invoice từ 1 PreviewRow
  const buildPayload = (p: PreviewRow) => {
    const r = p.row;
    const inv = p.invoice;
    const data: Record<string, any> = {
      SCT: r.SCT,
      StartDate: r.StartDate,
      EndDate: r.EndDate,
      HSN: r.HSN,
      NMua: inv.nmua.ten,
      MKHang: inv.nmua.mkhang,
      NBan: inv.nban.ten,
      DChiNBan: inv.nban.dchi,
      DChiNMua: r.pointAddress || inv.nmua.dchi,
      SHDon: inv.shdon,
      LoaiHD: inv.loaiHD,
      BT_dau: r.bieu.BT.old, BT_cuoi: r.bieu.BT.moi,
      CD_dau: r.bieu.CD.old, CD_cuoi: r.bieu.CD.moi,
      TD_dau: r.bieu.TD.old, TD_cuoi: r.bieu.TD.moi,
      VC_dau: r.bieu.VC.old, VC_cuoi: r.bieu.VC.moi,
      phu_BT: r.bieu.BT.phuTru, phu_CD: r.bieu.CD.phuTru,
      phu_TD: r.bieu.TD.phuTru, phu_VC: r.bieu.VC.phuTru,
      SL_BT: r.bieu.BT.sluong, SL_CD: r.bieu.CD.sluong, SL_TD: r.bieu.TD.sluong,
      TongSL_HC: r.TongSL_HC, TongSL_PK: r.TongSL_PK,
      ThTien_HC: r.ThTien_HC, ThTien_PK: r.ThTien_PK,
      CosFi: r.CosFi, KCosFi: r.KCosFi,
    };
    if (inv.loaiHD === 'VC') {
      // Hóa đơn phản kháng: hữu công luôn = 0 → KHÔNG ghi TongSL_HC/ThTien_HC để
      // không nuốt số liệu hữu công đã nạp từ hóa đơn HC; cũng không ghi đơn giá hữu công.
      delete data.TongSL_HC; delete data.ThTien_HC;
      delete data.SL_BT; delete data.SL_CD; delete data.SL_TD;
    } else {
      // Hóa đơn hữu công: giữ TongSL_HC/ThTien_HC (đọc trực tiếp từ XML) + đơn giá;
      // không ghi số liệu phản kháng để khỏi nuốt dữ liệu từ hóa đơn VC.
      delete data.TongSL_PK; delete data.ThTien_PK;
      delete data.CosFi; delete data.KCosFi;
    }
    return data;
  };

  const doImport = async () => {
    if (isImporting) return;
    const rows = previewRows.filter(p => selected[p.id]);
    if (rows.length === 0) { showToast('Chưa chọn dòng nào để ghi', 'warning'); return; }
    const ok = await confirm({
      title: 'Ghi vào hệ thống?',
      message: `Sẽ ghi/cập nhật ${rows.length} bản ghi vào collection "${INVOICE_COLLECTION}". Bản trùng (số công tơ + kỳ) sẽ được cập nhật.`,
      confirmLabel: 'Ghi dữ liệu',
      variant: 'info',
    });
    if (!ok) return;

    setIsImporting(true);
    setImportProgress({ done: 0, total: rows.length });
    let created = 0, updated = 0, failed = 0;
    try {
      // Chỉ dò trùng trong các SCT đang nạp (không getFullList toàn bảng — không khả thi khi
      // collection invoice lên tới hàng triệu dòng).
      const scts = Array.from(new Set(rows.map(p => p.row.SCT).filter(Boolean)));
      const sctFilter = scts.map(s => pb.filter('SCT = {:sct}', { sct: s })).join(' || ');
      const existing = sctFilter
        ? await pb.collection(INVOICE_COLLECTION).getFullList<any>({ filter: sctFilter, requestKey: null })
        : [];
      // Khóa upsert gồm cả LoaiHD: hóa đơn vô công (VC) là HÓA ĐƠN RIÊNG, tách khỏi hữu
      // công (HC) — khách có thể thanh toán 2 hóa đơn vào ngày khác nhau.
      const idByKey = new Map<string, string>();
      existing.forEach(rec => {
        const key = `${rec.SCT}|${(rec.StartDate || '').split('T')[0].split(' ')[0]}|${(rec.EndDate || '').split('T')[0].split(' ')[0]}|${rec.LoaiHD || ''}`;
        idByKey.set(key, rec.id);
      });

      for (let i = 0; i < rows.length; i++) {
        const p = rows[i];
        try {
          const payload = buildPayload(p);
          const key = `${p.row.SCT}|${p.row.StartDate}|${p.row.EndDate}|${p.invoice.loaiHD}`;
          const existingId = idByKey.get(key);
          if (existingId) {
            await pb.collection(INVOICE_COLLECTION).update(existingId, payload);
            updated++;
          } else {
            const rec = await pb.collection(INVOICE_COLLECTION).create(payload);
            idByKey.set(key, rec.id); // tránh tạo trùng trong cùng mẻ
            created++;
          }
        } catch {
          failed++;
        }
        setImportProgress({ done: i + 1, total: rows.length });
      }
      showToast(
        `Hoàn tất: tạo mới ${created}, cập nhật ${updated}` + (failed ? `, lỗi ${failed}` : ''),
        failed ? 'warning' : 'success',
      );
    } catch (err: any) {
      showToast(`Lỗi khi ghi: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-fade-in relative">
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

      {/* Header */}
      <div className="vl-card p-6 md:p-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 bg-[#e8f3ff] rounded-2xl text-[#5a8dee]">
            <Database className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Nạp dữ liệu nhanh</h1>
        </div>
        <p className="text-sm text-slate-500 max-w-2xl">
          Tải lên hàng loạt file XML hóa đơn điện, xem trước rồi ghi vào hệ thống. Hỗ trợ hóa đơn thường, đổi giá giữa kỳ (tách 2 dòng) và hóa đơn phản kháng.
        </p>
      </div>

      {/* Lấy dữ liệu trực tiếp từ web service HĐĐT */}
      <div className="vl-card p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <CloudDownload className="w-5 h-5 text-[#5a8dee]" />
          <h2 className="text-base font-black text-slate-800">Lấy hóa đơn trực tiếp (không cần tải file)</h2>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Chọn kỳ rồi bấm một nút — hệ thống tự lấy toàn bộ hóa đơn của tháng từ dịch vụ HĐĐT GELEX.
        </p>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Kỳ</label>
            <select
              value={fetchTerm}
              onChange={e => setFetchTerm(Number(e.target.value))}
              disabled={isFetching}
              className="w-24 px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#5a8dee]/40 disabled:opacity-60"
            >
              {[1, 2, 3].map(t => (
                <option key={t} value={t}>Kỳ {t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Tháng</label>
            <MonthPicker value={fetchYM} onChange={setFetchYM} className="w-44" />
          </div>
          <button
            onClick={handleFetch}
            disabled={isFetching}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white bg-[#5a8dee] hover:bg-[#4a7de2] disabled:opacity-60 shadow-sm transition-all"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
            {isFetching ? 'Đang lấy…' : 'Lấy dữ liệu'}
          </button>
        </div>
        {isFetching && fetchProgress && (
          <FetchStepper progress={fetchProgress} />
        )}
      </div>

      {/* Dropzone */}
      <div className="vl-card p-6 md:p-8">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Hoặc tải file XML thủ công</div>
        <label
          htmlFor="xml-input"
          className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-300 rounded-2xl py-10 cursor-pointer hover:border-[#5a8dee] hover:bg-[#f4f8ff]/50 transition-colors"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        >
          <div className="p-3 bg-[#e8f3ff] rounded-2xl text-[#5a8dee]"><Upload className="w-7 h-7" /></div>
          <div className="text-center">
            <p className="text-sm font-bold text-slate-700">Kéo–thả hoặc bấm để chọn nhiều file .xml</p>
            <p className="text-xs text-slate-400 mt-1">Có thể chọn nhiều hóa đơn cùng lúc</p>
          </div>
          <input
            id="xml-input"
            type="file"
            accept=".xml,application/xml,text/xml"
            multiple
            className="hidden"
            onChange={e => { handleFiles(e.target.files); e.currentTarget.value = ''; }}
          />
        </label>

        {files.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            {files.map(f => (
              <span key={f.fileName} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                <FileCode2 className="w-3.5 h-3.5 text-[#5a8dee]" /> {f.fileName}
                <span className="text-slate-400">({f.invoice.rows.length})</span>
              </span>
            ))}
            <button onClick={clearAll} className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:bg-rose-50 px-2.5 py-1 rounded-lg transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Xóa hết
            </button>
          </div>
        )}
      </div>

      {/* Preview + actions */}
      {previewRows.length > 0 && (
        <div className="vl-card overflow-hidden">
          <div className="p-5 md:p-6 border-b border-slate-150 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
            <div>
              <h3 className="text-base font-black text-slate-800">Xem trước ({previewRows.length} công tơ · đã chọn {selectedCount})</h3>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => setAll(true)} className="px-3 py-1.5 rounded text-xs font-bold text-slate-500 border border-slate-200 hover:bg-slate-50">Chọn hết</button>
                <button onClick={() => setAll(false)} className="px-3 py-1.5 rounded text-xs font-bold text-slate-500 border border-slate-200 hover:bg-slate-50">Bỏ chọn</button>
              </div>
            </div>
            <button
              onClick={doImport}
              disabled={isImporting || selectedCount === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-[#5a8dee] hover:bg-[#4a7de2] disabled:opacity-60 shadow-sm transition-all"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {isImporting
                ? `Đang ghi... ${importProgress ? `${importProgress.done}/${importProgress.total}` : ''}`
                : `Ghi vào hệ thống (${selectedCount})`}
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {grouped.map(g => (
              <div key={g.name}>
                <div className="px-5 py-3 bg-slate-50/40 flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#5a8dee]" />
                  <span className="font-bold text-slate-800 text-sm">{g.name}</span>
                  <span className="text-[11px] font-semibold text-slate-400">· {g.rows.length} công tơ</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[1040px] text-sm">
                    <thead>
                      <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                        <th className="py-2.5 px-3 w-10"></th>
                        <th className="py-2.5 px-3">Số công tơ</th>
                        <th className="py-2.5 px-3">Kỳ</th>
                        <th className="py-2.5 px-3 text-right">HSN</th>
                        {ACTIVE_BIEU.map(b => (
                          <th key={b} className="py-2.5 px-3 text-right">{BIEU_LABEL[b]}: thực tế / đơn giá</th>
                        ))}
                        <th className="py-2.5 px-3 text-right">VC (thực tế)</th>
                        <th className="py-2.5 px-3 text-right">Thành tiền (HC)</th>
                        <th className="py-2.5 px-3 text-center">Loại</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {g.rows.map(p => {
                        const r = p.row;
                        const isVC = p.invoice.loaiHD === 'VC';
                        return (
                          <tr key={p.id} className={`hover:bg-slate-50/70 transition-colors ${selected[p.id] ? '' : 'opacity-50'}`}>
                            <td className="py-2.5 px-3">
                              <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggleRow(p.id)} className="w-4 h-4 accent-[#5a8dee]" />
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-[#5a8dee]">{r.SCT}</td>
                            <td className="py-2.5 px-3 text-xs font-semibold text-slate-500">{fmtDate(r.StartDate)}–{fmtDate(r.EndDate)}</td>
                            <td className="py-2.5 px-3 text-right font-mono">{fmt(r.HSN)}</td>
                            {ACTIVE_BIEU.map(b => (
                              <td key={b} className="py-2.5 px-3 text-right font-mono text-xs">
                                <span className="text-amber-600 font-bold">{fmt(thucTe(r, b))}</span>
                                <span className="text-slate-400"> / {fmt(r.bieu[b].dgia)}</span>
                              </td>
                            ))}
                            <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-600">{fmt(thucTe(r, 'VC'))}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800">
                              {isVC ? <span className="text-violet-600">PK {fmt(r.ThTien_PK)}</span> : fmt(thanhTienHC(r))}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${isVC ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {isVC ? 'Phản kháng' : 'Hữu công'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewRows.length === 0 && files.length === 0 && (
        <div className="vl-card py-16 text-center text-slate-400">
          <div className="flex flex-col items-center justify-center">
            <FileSpreadsheet className="w-12 h-12 text-slate-200 mb-3" />
            <p className="text-sm">Chưa có dữ liệu. Hãy tải lên file XML hóa đơn.</p>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
