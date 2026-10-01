import { useMemo, useState, useCallback, useEffect } from 'react';
import { pb } from '../../lib/pocketbase';
import { useConfirm } from '../ui/ConfirmDialog';
import { parseInvoiceXml, type ParsedInvoice, type MeterPeriodRow, type Bieu } from '../../lib/parseInvoiceXml';
import {
  Upload, FileCode2, Database, Trash2,
  Users, Loader2, FileSpreadsheet,
} from 'lucide-react';

/* ============================================================
   Nạp dữ liệu — tải nhiều XML hóa đơn điện tử, xem trước, ghi hàng loạt.
   Chỉ dành cho khối Kinh doanh.

   User chốt 01/10/2026:
   - CHỈ nhận XML tải lên (XML tải từ cổng hóa đơn). Đã BỎ "Lấy trực tiếp từ CCIS":
     XML của CCIS `GetXML` không có mã CQT (`MCCQT`) ⇒ không gửi khách được.
   - XML thiếu `MCCQT` hoặc thiếu mã tra cứu (`Fkey`) bị từ chối ngay khi đọc.
   - Mỗi XML ghi MỘT bản ghi `einvoice` (đầu mục + toàn văn XML + trạng thái mail),
     rồi các dòng chi tiết vào `invoice` NHƯ CŨ. Hai bên nối bằng `BillId`.
============================================================ */

const INVOICE_COLLECTION = 'invoice';
const EINVOICE_COLLECTION = 'einvoice';

import { toast as notify } from '../../lib/toast';

type ToastType = 'success' | 'error' | 'warning' | 'info';

const TOAST_TITLE: Record<ToastType, string> = {
  success: 'Thành công', error: 'Lỗi', warning: 'Lưu ý', info: 'Thông báo',
};

const BIEU_LABEL: Record<Bieu, string> = { BT: 'BT', CD: 'CĐ', TD: 'TĐ', VC: 'VC' };

const fmt = (n: number, d = 0) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(n);
const fmtDate = (s: string) => {
  const [y, m, d] = (s || '').split('-');
  return d && m && y ? `${d}/${m}/${y}` : s || '—';
};

// điện trực tiếp = (mới - cũ) × HSN ; thực tế = trực tiếp - phụ trừ
const trucTiep = (row: MeterPeriodRow, b: Bieu) =>
  (row.bieu[b].moi - row.bieu[b].old) * row.HSN;
const thucTe = (row: MeterPeriodRow, b: Bieu) =>
  trucTiep(row, b) - row.bieu[b].phuTru;
// sản lượng theo biểu: BT/CĐ/TĐ đọc trực tiếp từ XML (sluong), VC = tiêu thụ thực tế
const sanLuong = (row: MeterPeriodRow, b: Bieu) =>
  b === 'VC' ? thucTe(row, 'VC') : row.bieu[b].sluong;

interface FileEntry {
  fileName: string;
  invoice: ParsedInvoice;
  /** Toàn văn XML — lưu nguyên vào `einvoice.xml`. */
  xml: string;
}
// 1 dòng xem trước = 1 công tơ/khoảng, kèm meta hóa đơn
interface PreviewRow {
  id: string; // fileName|SCT|start|end
  fileName: string;
  invoice: ParsedInvoice;
  row: MeterPeriodRow;
}

export default function QuickImportManager() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const showToast = useCallback((message: string, t: ToastType = 'info') => {
    notify.show(t, TOAST_TITLE[t], message, { duration: 4500 });
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

  // Tra DB xem mỗi dòng đã tồn tại chưa (để hiển thị "Cập nhật" / "Mới").
  // Khóa giống lúc upsert: SCT|StartDate|EndDate|LoaiHD.
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    const scts = Array.from(new Set(previewRows.map(p => p.row.SCT).filter(Boolean)));
    if (scts.length === 0) { setExistingKeys(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const filter = scts.map(s => pb.filter('SCT = {:s}', { s })).join(' || ');
        const recs = await pb.collection(INVOICE_COLLECTION).getFullList<any>({ filter, requestKey: null });
        if (cancelled) return;
        const keys = new Set<string>();
        recs.forEach(r => {
          const d = (v: string) => (v || '').split('T')[0].split(' ')[0];
          keys.add(`${r.SCT}|${d(r.StartDate)}|${d(r.EndDate)}|${r.LoaiHD || ''}`);
        });
        setExistingKeys(keys);
      } catch {
        if (!cancelled) setExistingKeys(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [previewRows]);
  const rowKey = (p: PreviewRow) => `${p.row.SCT}|${p.row.StartDate}|${p.row.EndDate}|${p.invoice.loaiHD}`;

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

  // Parse danh sách XML tải lên rồi gộp vào danh sách xem trước.
  const ingestXml = (list: { fileName: string; xml: string }[]): { ok: number; errors: string[] } => {
    const parsed: FileEntry[] = [];
    const errors: string[] = [];
    for (const { fileName, xml } of list) {
      try {
        const invoice = parseInvoiceXml(xml);
        // Chốt chặn: thiếu mã CQT = XML chưa qua cơ quan thuế (vd XML lấy từ CCIS) —
        // không gửi khách được, không có mã tra cứu ⇒ không cho nạp.
        if (!invoice.header.mccqt) throw new Error('không có mã CQT (MCCQT) — cần XML tải từ cổng hóa đơn, không phải từ CCIS');
        if (!invoice.billId) throw new Error('không có BillId');
        if (!invoice.header.maTraCuu) throw new Error('không có mã tra cứu (Fkey)');
        parsed.push({ fileName, invoice, xml });
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
      BillId: inv.billId,
      IndexId: r.indexId,
      LoaiHD: inv.loaiHD,
      BT_dau: r.bieu.BT.old, BT_cuoi: r.bieu.BT.moi,
      CD_dau: r.bieu.CD.old, CD_cuoi: r.bieu.CD.moi,
      TD_dau: r.bieu.TD.old, TD_cuoi: r.bieu.TD.moi,
      VC_dau: r.bieu.VC.old, VC_cuoi: r.bieu.VC.moi,
      phu_BT: r.bieu.BT.phuTru, phu_CD: r.bieu.CD.phuTru,
      phu_TD: r.bieu.TD.phuTru, phu_VC: r.bieu.VC.phuTru,
      SL_BT: r.bieu.BT.sluong, SL_CD: r.bieu.CD.sluong, SL_TD: r.bieu.TD.sluong,
      TongSL_HC: r.TongSL_HC, TongSL_PK: r.TongSL_PK,
      // Gộp thành tiền: ThTien (trước thuế) = HC + PK; VAT (0.08) + ThTienVAT (sau thuế) đọc/tính từ XML.
      ThTien: r.ThTien, VAT: r.VAT, ThTienVAT: r.ThTienVAT,
      CosFi: r.CosFi, KCosFi: r.KCosFi,
    };
    if (inv.loaiHD === 'VC') {
      // Hóa đơn phản kháng: hữu công luôn = 0 → KHÔNG ghi TongSL_HC (giữ số hữu công từ hóa đơn HC);
      // cũng không ghi đơn giá hữu công.
      delete data.TongSL_HC;
      delete data.SL_BT; delete data.SL_CD; delete data.SL_TD;
    } else {
      // Hóa đơn hữu công: không ghi số liệu phản kháng để khỏi nuốt dữ liệu từ hóa đơn VC.
      delete data.TongSL_PK;
      delete data.CosFi; delete data.KCosFi;
    }
    return data;
  };

  // Bản ghi `einvoice` cho 1 file XML: đầu mục + toàn văn XML. KHÔNG có mail_* (xem doImport).
  const buildEinvoicePayload = (f: FileEntry) => {
    const inv = f.invoice;
    const h = inv.header;
    return {
      BillId: inv.billId, LoaiHD: inv.loaiHD,
      Year: h.year, Month: h.month, Term: h.term,
      StartDate: h.startDate || null, EndDate: h.endDate || null,
      KHMSHDon: h.khmshdon, KHHDon: h.khhdon, SHDon: h.shdon, NLap: h.nlap || null,
      MCCQT: h.mccqt, MaTraCuu: h.maTraCuu,
      MSTNBan: h.mstNBan, NBan: inv.nban.ten,
      MKHang: inv.nmua.mkhang, NMua: inv.nmua.ten,
      TgTTTBSo: inv.tgTTTBSo,
      xml_name: f.fileName, xml: f.xml,
    };
  };

  const doImport = async () => {
    if (isImporting) return;
    const rows = previewRows.filter(p => selected[p.id]);
    if (rows.length === 0) { showToast('Chưa chọn dòng nào để ghi', 'warning'); return; }
    // Các hóa đơn (file XML) có ít nhất một dòng được chọn.
    const bills = Array.from(new Map(rows.map(p => [p.invoice.billId, p])).values());
    const ok = await confirm({
      title: 'Ghi vào hệ thống?',
      message: `Sẽ ghi ${bills.length} hóa đơn và ${rows.length} dòng chỉ số. Hóa đơn đã có (cùng BillId) `
        + 'và dòng trùng (số công tơ + kỳ) sẽ được cập nhật; trạng thái gửi email của hóa đơn giữ nguyên.',
      confirmLabel: 'Ghi dữ liệu',
      variant: 'info',
    });
    if (!ok) return;

    setIsImporting(true);
    setImportProgress({ done: 0, total: bills.length + rows.length });
    let created = 0, updated = 0, failed = 0;
    let eCreated = 0, eUpdated = 0;
    /** Hóa đơn ghi `einvoice` lỗi ⇒ KHÔNG ghi các dòng của nó, kẻo có chi tiết mà không có hóa đơn gốc. */
    const failedBills = new Set<string>();
    try {
      // ── 1. Đầu mục hóa đơn → `einvoice` (upsert theo BillId) ──
      const billFilter = bills.map(p => pb.filter('BillId = {:b}', { b: p.invoice.billId })).join(' || ');
      const eExisting = await pb.collection(EINVOICE_COLLECTION).getFullList<{ id: string; BillId: string }>({
        filter: billFilter, fields: 'id,BillId', requestKey: null,
      });
      const eIdByBill = new Map(eExisting.map(r => [r.BillId, r.id]));
      for (let i = 0; i < bills.length; i++) {
        const p = bills[i];
        const file = files.find(f => f.fileName === p.fileName);
        try {
          if (!file) throw new Error('mất nội dung XML');
          const body = buildEinvoicePayload(file);
          const exId = eIdByBill.get(p.invoice.billId);
          if (exId) { await pb.collection(EINVOICE_COLLECTION).update(exId, body); eUpdated++; }
          else {
            // Mới thì đánh dấu chưa gửi mail; cập nhật thì KHÔNG đụng mail_* (giữ lịch sử gửi).
            await pb.collection(EINVOICE_COLLECTION).create({ ...body, mail_status: 'chua_gui' });
            eCreated++;
          }
        } catch {
          failedBills.add(p.invoice.billId);
        }
        setImportProgress({ done: i + 1, total: bills.length + rows.length });
      }

      // ── 2. Chi tiết chỉ số / thành tiền → `invoice` (như cũ) ──
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
          if (failedBills.has(p.invoice.billId)) throw new Error('hóa đơn gốc lỗi');
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
        setImportProgress({ done: bills.length + i + 1, total: bills.length + rows.length });
      }
      const bad = failed + failedBills.size;
      showToast(
        `Hoàn tất: hóa đơn mới ${eCreated}, cập nhật ${eUpdated}` + (failedBills.size ? `, lỗi ${failedBills.size}` : '')
          + ` · dòng chỉ số mới ${created}, cập nhật ${updated}` + (failed ? `, lỗi ${failed}` : ''),
        bad ? 'warning' : 'success',
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
      {/* Header */}
      <div className="vl-card p-6 md:p-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 bg-accent-soft rounded-2xl text-accent">
            <Database className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-black text-ink tracking-tight uppercase">Nạp dữ liệu</h1>
        </div>
        <p className="text-sm text-soft max-w-2xl">
          Tải lên hàng loạt file XML hóa đơn điện tử (bản đã có mã cơ quan thuế), xem trước rồi ghi vào hệ thống.
          Hóa đơn không thêm hay sửa tay được — muốn sửa thì xóa ở màn Biên bản rồi nạp lại XML.
        </p>
      </div>

      {/* Card tải XML */}
      <div className="vl-card p-6 md:p-8">

            <label
              htmlFor="xml-input"
              className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-[var(--border-strong)] rounded-2xl py-10 cursor-pointer hover:border-accent hover:bg-accent-soft/50 transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            >
              <div className="p-3 bg-accent-soft rounded-2xl text-accent"><Upload className="w-7 h-7" /></div>
              <div className="text-center">
                <p className="text-sm font-bold text-dim">Kéo–thả hoặc bấm để chọn nhiều file .xml</p>
                <p className="text-xs text-faint mt-1">Có thể chọn nhiều hóa đơn cùng lúc</p>
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
                  <span key={f.fileName} className="inline-flex items-center gap-1.5 text-xs font-semibold text-dim bg-subtle border border-[var(--border)] px-2.5 py-1 rounded-lg">
                    <FileCode2 className="w-3.5 h-3.5 text-accent" /> {f.fileName}
                    <span className="text-faint">({f.invoice.rows.length})</span>
                  </span>
                ))}
                <button onClick={clearAll} className="inline-flex items-center gap-1.5 text-xs font-bold text-bad hover:bg-[var(--danger-soft)] px-2.5 py-1.5 rounded-lg transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Xóa dữ liệu đã tải
                </button>
              </div>
            )}

      </div>

      {/* Preview + actions */}
      {previewRows.length > 0 && (
        <div className="vl-card overflow-hidden">
          <div className="p-5 md:p-6 border-b border-slate-150 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-subtle/50">
            <div>
              <h3 className="text-base font-black text-ink">Xem trước ({previewRows.length} công tơ · đã chọn {selectedCount})</h3>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => setAll(true)} className="px-3 py-1.5 rounded text-xs font-bold text-soft border border-[var(--border)] hover:bg-subtle">Chọn hết</button>
                <button onClick={() => setAll(false)} className="px-3 py-1.5 rounded text-xs font-bold text-soft border border-[var(--border)] hover:bg-subtle">Bỏ chọn</button>
              </div>
            </div>
            <button
              onClick={doImport}
              disabled={isImporting || selectedCount === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-accent hover:bg-[var(--accent-hover)] disabled:opacity-60 shadow-sm transition-all"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {isImporting
                ? `Đang ghi... ${importProgress ? `${importProgress.done}/${importProgress.total}` : ''}`
                : `Ghi vào hệ thống (${selectedCount})`}
            </button>
          </div>

          <div className="divide-y divide-[var(--border)]">
            {grouped.map(g => (
              <div key={g.name}>
                <div className="px-5 py-3 bg-subtle/40 flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent" />
                  <span className="font-bold text-ink text-sm">{g.name}</span>
                  <span className="text-[11px] font-semibold text-faint">· {g.rows.length} công tơ</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[1040px] text-sm">
                    <thead>
                      <tr className="text-[11px] font-bold text-faint uppercase tracking-wider border-b border-[var(--border)]">
                        <th className="py-2.5 px-3 w-10"></th>
                        <th className="py-2.5 px-3">Số công tơ</th>
                        <th className="py-2.5 px-3">Kỳ</th>
                        <th className="py-2.5 px-3 text-right">HSN</th>
                        {(['BT', 'CD', 'TD', 'VC'] as Bieu[]).map(b => (
                          <th key={b} className="py-2.5 px-3 text-right">{BIEU_LABEL[b]}</th>
                        ))}
                        <th className="py-2.5 px-3 text-right">Tổng SL</th>
                        <th className="py-2.5 px-3 text-right">Trước thuế</th>
                        <th className="py-2.5 px-3 text-right">Sau thuế</th>
                        <th className="py-2.5 px-3 text-center">Trạng thái</th>
                        <th className="py-2.5 px-3 text-center">Loại</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {g.rows.map(p => {
                        const r = p.row;
                        const isVC = p.invoice.loaiHD === 'VC';
                        const exists = existingKeys.has(rowKey(p));
                        const tongSL = isVC ? r.TongSL_PK : r.TongSL_HC;
                        return (
                          <tr key={p.id} className={`hover:bg-subtle/70 transition-colors ${selected[p.id] ? '' : 'opacity-50'}`}>
                            <td className="py-2.5 px-3">
                              <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggleRow(p.id)} className="w-4 h-4 accent-[var(--accent)]" />
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-accent">{r.SCT}</td>
                            <td className="py-2.5 px-3 text-xs font-semibold text-soft">{fmtDate(r.StartDate)}–{fmtDate(r.EndDate)}</td>
                            <td className="py-2.5 px-3 text-right font-mono">{fmt(r.HSN)}</td>
                            {(['BT', 'CD', 'TD', 'VC'] as Bieu[]).map(b => (
                              <td key={b} className="py-2.5 px-3 text-right font-mono text-xs text-dim">
                                {fmt(sanLuong(r, b))}
                              </td>
                            ))}
                            <td className="py-2.5 px-3 text-right font-mono text-xs font-bold text-warn">{fmt(tongSL)}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-dim">
                              {isVC ? <span className="text-violet-600">{fmt(r.ThTien)}</span> : fmt(r.ThTien)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                              {fmt(r.ThTienVAT)}
                              {r.VAT > 0 && <span className="text-[9px] text-faint font-normal ml-1">({Math.round(r.VAT * 100)}%)</span>}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${exists ? 'bg-amber-100 text-warn' : 'bg-sky-100 text-sky-700'}`}>
                                {exists ? 'Cập nhật' : 'Mới'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${isVC ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-ok'}`}>
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
        <div className="vl-card py-16 text-center text-faint">
          <div className="flex flex-col items-center justify-center">
            <FileSpreadsheet className="w-12 h-12 text-faint mb-3" />
            <p className="text-sm">Chưa có dữ liệu. Hãy tải lên file XML hóa đơn.</p>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
