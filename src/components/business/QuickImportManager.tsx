import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { pb } from '../../lib/pocketbase';
import { useConfirm } from '../ui/ConfirmDialog';
import { parseInvoiceXml, type ParsedInvoice, type MeterPeriodRow, type Bieu } from '../../lib/parseInvoiceXml';
import { fetchFigureBooks, fetchInvoiceXmlForBook, type FetchProgress } from '../../lib/ccisApi';
import { MonthPicker } from '../ui/DateTimePickers';
import {
  Upload, FileCode2, Database, CheckCircle2, AlertCircle, Trash2,
  Users, Loader2, FileSpreadsheet, CloudDownload, Check, Layers, ChevronDown,
  BookOpen, ListChecks,
} from 'lucide-react';

const FIGUREBOOK_COLLECTION = 'FigureBook';
interface BookOption { FigureBookId: number; BookName: string; }

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

/* Thanh tiến trình dạng stepper ngang cho luồng 2 bước: Lấy sổ → Hóa đơn → XML → Hoàn tất. */
const FETCH_STEPS: { phase: FetchProgress['phase']; label: string }[] = [
  { phase: 'books', label: 'Lấy sổ' },
  { phase: 'bills', label: 'Lấy hóa đơn' },
  { phase: 'xml', label: 'Tải XML' },
  { phase: 'done', label: 'Hoàn tất' },
];

interface StepperState {
  current: number;          // chỉ số bước đang/đến lượt (>= length ⇒ hoàn tất)
  running: boolean;         // có tác vụ đang chạy không
  label?: string;           // mô tả chi tiết đang xử lý
  count?: { done: number; total: number } | null;
}

function FetchStepper({ current, running, label, count }: StepperState) {
  const allDone = current >= FETCH_STEPS.length;
  return (
    <div className="mt-6 rounded-2xl bg-white border border-slate-100 shadow-[0_8px_24px_-12px_rgba(25,42,70,0.18)] px-6 md:px-8 py-7">
      <div className="flex items-start">
        {FETCH_STEPS.map((step, i) => {
          const done = i < current;
          const isActive = !allDone && i === current;
          const isLast = i === FETCH_STEPS.length - 1;
          return (
            <div key={step.phase} className="flex-1 flex flex-col items-start relative min-w-0">
              {/* Đường nối sang bước kế (từ tâm vòng tròn này tới tâm vòng tròn kế) */}
              {!isLast && (
                <div className="absolute top-[13px] left-[14px] w-full h-[3px] rounded-full bg-blue-100 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      done ? 'w-full bg-emerald-500'
                      : isActive ? 'w-1/2 bg-gradient-to-r from-[#2f6bff] to-blue-200'
                      : 'w-0'
                    }`}
                  />
                </div>
              )}

              {/* Vòng tròn bước */}
              <div
                className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
                  done
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-300/40'
                    : isActive
                    ? 'bg-[#2f6bff] shadow-lg shadow-[#2f6bff]/30'
                    : 'bg-blue-100'
                }`}
              >
                {done ? (
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                ) : isActive && running ? (
                  <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                ) : isActive ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-white ring-2 ring-white/60" />
                ) : null}
              </div>

              {/* Nhãn */}
              <div className="mt-3 pr-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Step {i + 1}
                </div>
                <div className={`text-sm font-bold mt-0.5 ${done || isActive ? 'text-slate-800' : 'text-slate-400'}`}>
                  {step.label}
                </div>
                <div
                  className={`text-[11px] font-semibold mt-0.5 ${
                    done ? 'text-emerald-500' : isActive ? 'text-[#2f6bff]' : 'text-slate-400'
                  }`}
                >
                  {done ? 'Hoàn tất' : isActive ? (running ? 'Đang xử lý' : 'Sẵn sàng') : 'Chờ'}
                  {isActive && running && count && count.total > 0 && (
                    <span className="font-mono"> · {count.done}/{count.total}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dòng chi tiết đang xử lý */}
      {running && label && (
        <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] font-semibold text-slate-400 truncate">
          {label}
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
  const [books, setBooks] = useState<BookOption[]>([]);          // danh sách sổ (collection FigureBook)
  const [selectedBookId, setSelectedBookId] = useState<number | ''>('');
  const [isFetchingBooks, setIsFetchingBooks] = useState(false);
  const [isFetchingInvoices, setIsFetchingInvoices] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<FetchProgress | null>(null);
  const [invoicesDone, setInvoicesDone] = useState(false);      // đã hoàn tất lấy hóa đơn (cho stepper)
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const showToast = useCallback((message: string, t: ToastType = 'info') => {
    setToast({ message, type: t });
    setTimeout(() => setToast(null), 4500);
  }, []);

  // Nạp danh sách sổ từ collection FigureBook
  const loadBooks = useCallback(async () => {
    try {
      const recs = await pb.collection(FIGUREBOOK_COLLECTION).getFullList<any>({ sort: 'BookName', requestKey: null });
      const opts = recs.map(r => ({ FigureBookId: Number(r.FigureBookId), BookName: r.BookName || String(r.FigureBookId) }));
      setBooks(opts);
      setSelectedBookId(prev => (prev !== '' && opts.some(o => o.FigureBookId === prev) ? prev : (opts[0]?.FigureBookId ?? '')));
    } catch {
      /* collection có thể chưa có quyền/ chưa tạo — bỏ qua, để trống dropdown */
    }
  }, []);
  useEffect(() => { loadBooks(); }, [loadBooks]);

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

  const parseYM = () => {
    const [yStr, mStr] = fetchYM.split('-');
    return { year: Number(yStr), month: Number(mStr) };
  };

  // BƯỚC A — Lấy danh sách sổ (GetFigureBook) và lưu vào collection FigureBook.
  const handleFetchBooks = async () => {
    if (isFetchingBooks || isFetchingInvoices) return;
    const { year, month } = parseYM();
    if (!year || !month) { showToast('Chưa chọn tháng', 'warning'); return; }
    setIsFetchingBooks(true);
    setInvoicesDone(false);
    setFetchProgress({ phase: 'books', done: 0, total: 1, label: 'Bắt đầu…' });
    try {
      const { books: fetched, errors } = await fetchFigureBooks(year, month, fetchTerm, setFetchProgress);
      // Upsert theo FigureBookId vào collection FigureBook
      const ids = Array.from(new Set(fetched.map(b => b.FigureBookId).filter(Boolean)));
      const existing = ids.length
        ? await pb.collection(FIGUREBOOK_COLLECTION).getFullList<any>({
            filter: ids.map(id => pb.filter('FigureBookId = {:id}', { id })).join(' || '),
            requestKey: null,
          })
        : [];
      const idByBook = new Map<number, string>();
      existing.forEach(r => idByBook.set(Number(r.FigureBookId), r.id));
      let saved = 0;
      for (const b of fetched) {
        if (!b.FigureBookId) continue;
        const data = { FigureBookId: b.FigureBookId, BookName: b.BookName || b.BookCode || String(b.FigureBookId) };
        try {
          const exId = idByBook.get(b.FigureBookId);
          if (exId) await pb.collection(FIGUREBOOK_COLLECTION).update(exId, data);
          else { const rec = await pb.collection(FIGUREBOOK_COLLECTION).create(data); idByBook.set(b.FigureBookId, rec.id); }
          saved++;
        } catch { /* bỏ qua lỗi từng sổ */ }
      }
      await loadBooks();
      showToast(`Đã lưu ${saved} sổ` + (errors.length ? `, ${errors.length} lỗi` : ''), errors.length ? 'warning' : 'success');
    } catch (err: any) {
      showToast(`Lỗi lấy sổ: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setIsFetchingBooks(false);
      setFetchProgress(null);
    }
  };

  // BƯỚC B — Lấy hóa đơn (GetBill + GetXML) theo FigureBookId đã chọn.
  const handleFetchInvoices = async () => {
    if (isFetchingBooks || isFetchingInvoices) return;
    if (selectedBookId === '') { showToast('Chưa chọn sổ', 'warning'); return; }
    const { year, month } = parseYM();
    if (!year || !month) { showToast('Chưa chọn tháng', 'warning'); return; }
    const bookName = books.find(b => b.FigureBookId === selectedBookId)?.BookName || String(selectedBookId);
    setIsFetchingInvoices(true);
    setInvoicesDone(false);
    setFetchProgress({ phase: 'bills', done: 0, total: 1, label: 'Bắt đầu…' });
    try {
      const { items, errors } = await fetchInvoiceXmlForBook(Number(selectedBookId), fetchTerm, month, year, setFetchProgress);
      if (items.length === 0) {
        showToast(`Sổ "${bookName}" không có hóa đơn nào (kỳ ${fetchTerm} tháng ${month}/${year})` + (errors.length ? ` · ${errors[0]}` : ''), 'warning');
      } else {
        const { ok, errors: parseErrs } = ingestXml(items);
        const allErr = errors.length + parseErrs.length;
        setInvoicesDone(true);
        showToast(
          `Sổ "${bookName}": lấy ${ok}/${items.length} hóa đơn` + (allErr ? `, ${allErr} lỗi` : ''),
          allErr ? 'warning' : 'success',
        );
      }
    } catch (err: any) {
      showToast(`Lỗi lấy hóa đơn: ${err?.message || ''}`, 'error');
    } finally {
      setIsFetchingInvoices(false);
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

  // ── Trạng thái stepper (gộp 2 hành động Lấy sổ / Lấy hóa đơn) ──
  const busy = isFetchingBooks || isFetchingInvoices;
  const booksLoaded = books.length > 0;
  const stepperState: StepperState = (() => {
    if (busy && fetchProgress) {
      const idx = FETCH_STEPS.findIndex(s => s.phase === fetchProgress.phase);
      return {
        current: idx < 0 ? 0 : idx,
        running: true,
        label: fetchProgress.label,
        count: fetchProgress.total > 0 ? { done: fetchProgress.done, total: fetchProgress.total } : null,
      };
    }
    if (invoicesDone) return { current: FETCH_STEPS.length, running: false };
    return { current: booksLoaded ? 1 : 0, running: false };
  })();

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
          Bước 1: chọn kỳ/tháng rồi <b>Lấy sổ</b> để cập nhật danh mục sổ. Bước 2: chọn sổ trong danh sách rồi <b>Lấy hóa đơn</b> của sổ đó.
        </p>

        {/* Hàng 1: Kỳ + Tháng + Lấy sổ */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Kỳ</label>
            <div className="relative w-28 group">
              <Layers className="w-4 h-4 shrink-0 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-[#5a8dee] transition-colors" />
              <select
                value={fetchTerm}
                onChange={e => setFetchTerm(Number(e.target.value))}
                disabled={busy}
                className="peer w-full appearance-none pl-8 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 cursor-pointer transition-all hover:border-[#5a8dee]/50 focus:outline-none focus:ring-2 focus:ring-[#5a8dee] focus:border-[#5a8dee] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {[1, 2, 3].map(t => (
                  <option key={t} value={t}>Kỳ {t}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 peer-focus:text-[#5a8dee] transition-colors" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Tháng</label>
            <MonthPicker value={fetchYM} onChange={setFetchYM} className="w-44" />
          </div>
          <button
            onClick={handleFetchBooks}
            disabled={busy}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-[#5a8dee] bg-[#e8f3ff] hover:bg-[#d8eaff] disabled:opacity-60 transition-all"
          >
            {isFetchingBooks ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
            {isFetchingBooks ? 'Đang lấy sổ…' : 'Lấy sổ'}
          </button>
        </div>

        {/* Hàng 2: Dropdown sổ + Lấy hóa đơn */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mt-3">
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Sổ {books.length > 0 && <span className="text-slate-400 font-semibold normal-case">({books.length})</span>}
            </label>
            <div className="relative group sm:max-w-md">
              <BookOpen className="w-4 h-4 shrink-0 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-[#5a8dee] transition-colors" />
              <select
                value={selectedBookId}
                onChange={e => setSelectedBookId(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={busy || books.length === 0}
                className="peer w-full appearance-none pl-8 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 cursor-pointer transition-all hover:border-[#5a8dee]/50 focus:outline-none focus:ring-2 focus:ring-[#5a8dee] focus:border-[#5a8dee] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {books.length === 0 && <option value="">— Chưa có sổ, hãy bấm "Lấy sổ" —</option>}
                {books.map(b => (
                  <option key={b.FigureBookId} value={b.FigureBookId}>{b.BookName}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 peer-focus:text-[#5a8dee] transition-colors" />
            </div>
          </div>
          <button
            onClick={handleFetchInvoices}
            disabled={busy || selectedBookId === ''}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white bg-[#5a8dee] hover:bg-[#4a7de2] disabled:opacity-60 shadow-sm transition-all"
          >
            {isFetchingInvoices ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
            {isFetchingInvoices ? 'Đang lấy hóa đơn…' : 'Lấy hóa đơn'}
          </button>
        </div>

        <FetchStepper {...stepperState} />
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
