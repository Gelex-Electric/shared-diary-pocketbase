import { useState, useMemo } from 'react';
import { X, AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { pb } from '../../lib/pocketbase';
import { toast as notify } from '../../lib/toast';
import { type CatalogData, ASSET_TYPES, ASSET_TYPE_LABEL } from '../../lib/catalog';
import { parseAssets, type ParsedRow } from '../../lib/assetImport';
import { parseRatioText } from '../../lib/ratio';
import { DatePicker } from '../ui/DateTimePickers';
import { Select } from '../ui/Select';

/**
 * Nhập hàng loạt vật tư bằng BẢNG gõ trực tiếp (user chốt 05/08).
 *
 * Trước đây là ô dán văn bản + nút tải file mẫu. Bỏ cả hai: hàng tiêu đề của
 * bảng CHÍNH LÀ file mẫu, không phải tải về rồi mở Excel rồi dán ngược lại.
 * Vẫn dán được cả vùng từ Excel — dán vào một ô thì tự trải ra các ô còn lại.
 *
 * Kiểm tra dữ liệu vẫn dùng `parseAssets` như cũ: một nguồn luật duy nhất cho
 * cả hai lối vào, tránh hai chỗ kiểm hai kiểu.
 */

/** Cột hiện trên bảng. Bỏ `model` vì user đã yêu cầu bỏ cột đó ở bảng vật tư. */
const GRID_COLS = [
  { key: 'so_hieu', label: 'Số hiệu *', w: 'w-40' },
  { key: 'loai', label: 'Loại *', w: 'w-28' },
  // MOT o ty so dang 2500/5 (user chot 05/08) - giong o Ty so cua bang vat tu,
  // khong bat nguoi dung tach so cap / thu cap ra hai o.
  { key: 'ty_so', label: 'Tỷ số', w: 'w-28' },
  { key: 'hang_sx', label: 'Hãng SX', w: 'w-28' },
  { key: 'cap_chinh_xac', label: 'Cấp CX', w: 'w-20' },
  { key: 'nam_sx', label: 'Năm SX', w: 'w-20' },
  { key: 'ngay_kiem_dinh', label: 'Ngày kiểm định', w: 'w-36' },
  { key: 'kho', label: 'Kho', w: 'w-32' },
  { key: 'ghi_chu', label: 'Ghi chú', w: 'w-40' },
] as const;

/** Thứ tự cột khi ghép về dạng văn bản cho `parseAssets` — phải có `model`. */
const TSV_ORDER = [
  'so_hieu', 'loai', 'so_cap', 'thu_cap', 'hang_sx',
  'model', 'cap_chinh_xac', 'nam_sx', 'ngay_kiem_dinh', 'kho', 'ghi_chu',
];

type Row = Record<string, string>;
const emptyRow = (): Row =>
  ({ ...Object.fromEntries(TSV_ORDER.map(k => [k, ''])), ty_so: '' });

/** `2500/5` -> hai o so_cap / thu_cap ma `parseAssets` dang cho doi. */
function withRatio(r: Row): Row {
  const t = (r.ty_so || '').trim();
  if (!t) return r;
  const p = parseRatioText(t);
  // Go sai dinh dang: de nguyen vao so_cap de parseAssets bao loi thieu thu cap
  // thay vi im lang bo qua.
  if (!p || p.ratio_primary == null) return { ...r, so_cap: t, thu_cap: '' };
  return { ...r, so_cap: String(p.ratio_primary), thu_cap: String(p.ratio_secondary) };
}

export default function BulkImportAssets({
  data, onClose, onDone,
}: { data: CatalogData; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 6 }, emptyRow));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [docNo, setDocNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ made: number; failed: number } | null>(null);

  /** Dòng có ít nhất một ô có chữ — dòng trống hoàn toàn thì bỏ qua. */
  const filled = useMemo(
    () => rows.map((r, i) => ({ r, i })).filter(({ r }) => Object.values(r).some(v => v.trim())),
    [rows],
  );

  /** Kiểm bằng chính `parseAssets`: ghép về TSV không tiêu đề, giữ ánh xạ dòng. */
  const parsed = useMemo(() => {
    if (filled.length === 0) return [] as ParsedRow[];
    const tsv = filled.map(({ r }) => {
      const w = withRatio(r);
      return TSV_ORDER.map(c => w[c] ?? '').join('\t');
    }).join('\n');
    return parseAssets(tsv, data);
  }, [filled, data]);

  /** Lỗi/cảnh báo theo CHỈ SỐ DÒNG TRÊN BẢNG, không theo số dòng văn bản. */
  const byGridRow = useMemo(() => {
    const m = new Map<number, ParsedRow>();
    parsed.forEach((p, k) => { if (filled[k]) m.set(filled[k].i, p); });
    return m;
  }, [parsed, filled]);

  const good = parsed.filter(r => r.errors.length === 0);
  const bad = parsed.filter(r => r.errors.length > 0);

  const setCell = (i: number, key: string, v: string) => {
    setResult(null);
    setRows(prev => {
      const next = prev.map((r, k) => (k === i ? { ...r, [key]: v } : r));
      // Gõ tới dòng cuối thì tự thêm dòng mới — khỏi phải bấm "Thêm dòng".
      if (i === next.length - 1 && v.trim()) next.push(emptyRow());
      return next;
    });
  };

  /**
   * Dán cả vùng từ Excel: trải theo hàng/cột bắt đầu từ ô đang đứng.
   * Nếu chỉ dán một ô thì để trình duyệt xử lý như bình thường.
   */
  const onPaste = (e: React.ClipboardEvent, rowIdx: number, colIdx: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
    e.preventDefault();
    setResult(null);
    const grid = text.replace(/\r/g, '').split('\n').filter(l => l.length).map(l => l.split('\t'));
    setRows(prev => {
      const next = prev.map(r => ({ ...r }));
      while (next.length < rowIdx + grid.length + 1) next.push(emptyRow());
      grid.forEach((cells, dy) => {
        cells.forEach((val, dx) => {
          const c = GRID_COLS[colIdx + dx];
          if (c) next[rowIdx + dy][c.key] = val.trim();
        });
      });
      return next;
    });
  };

  const doImport = async () => {
    if (good.length === 0) return;
    setBusy(true);
    let made = 0, failed = 0;
    const whByCode = new Map(data.warehouses.map(w => [w.code, w.id]));

    for (const r of good) {
      try {
        const whId = r.warehouseCode ? whByCode.get(r.warehouseCode) ?? '' : '';
        const body: Record<string, unknown> = {
          serial: r.serial, type: r.type, current_status: 'kho', hes_seen: false,
        };
        if (whId) body.current_warehouse = whId;
        if (r.ratio_primary !== undefined) body.ratio_primary = r.ratio_primary;
        if (r.ratio_secondary !== undefined) body.ratio_secondary = r.ratio_secondary;
        if (r.ratio !== undefined) body.ratio = r.ratio;
        if (r.manufacture_year) body.manufacture_year = r.manufacture_year;
        if (r.calibration_date) body.calibration_date = r.calibration_date;
        if (r.next_calibration) body.next_calibration = r.next_calibration;
        if (r.manufacturer) body.manufacturer = r.manufacturer;
        if (r.model_desc) body.model_desc = r.model_desc;
        if (r.accuracy_class) body.accuracy_class = r.accuracy_class;
        if (r.note) body.note = r.note;

        const asset = await pb.collection('vt_asset').create(body);

        // Sổ cái: nhập kho. Ghi event SAU khi tạo asset vì event cần asset id.
        await pb.collection('vt_event').create({
          asset: asset.id, serial: r.serial, event: 'nhap_kho',
          to_warehouse: whId, at: date, by: pb.authStore.model?.id,
          document_no: docNo, note: r.note || '',
        });
        made++;
      } catch (err: any) {
        failed++;
        r.errors.push('Ghi thất bại: ' + (err?.message || String(err)));
      }
    }

    setBusy(false);
    setResult({ made, failed });
    if (made > 0) {
      notify.show('success', 'Đã nhập kho', `${made} vật tư`);
      // Dọn các dòng đã ghi xong, giữ lại dòng lỗi để sửa tiếp.
      const okSerials = new Set(good.map(g => g.serial));
      setRows(prev => {
        const keep = prev.filter(r => !okSerials.has((r.so_hieu || '').trim()));
        return keep.length ? keep : Array.from({ length: 6 }, emptyRow);
      });
      onDone();
    }
    if (failed > 0) notify.show('error', 'Có dòng ghi lỗi', `${failed} dòng`);
  };

  const cellCls = 'w-full px-2 py-1.5 bg-transparent border-0 rounded-none text-sm outline-none focus:bg-accent-soft';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="bg-surface border border-[var(--border-strong)] w-full max-w-6xl max-h-[90vh] overflow-y-auto p-5 space-y-4"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-ink">Nhập hàng loạt vật tư</h3>
            <p className="text-sm text-soft mt-1">
              Gõ thẳng vào bảng, hoặc dán cả vùng từ Excel vào một ô. Chỉ những dòng hợp lệ mới được ghi.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-faint hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <DatePicker value={date} onChange={setDate}
            label="Ngày nhập kho *" className="w-[150px]" usePortal />
          <label className="block">
            <span className="text-xs font-semibold text-soft">Số biên bản / phiếu nhập</span>
            <input type="text" value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="VD: PN-2026-07"
              className="mt-1 block px-3 py-2 border border-[var(--border)] bg-surface rounded text-dim text-sm
                focus:outline-none focus:ring-1 focus:ring-accent w-[180px]" />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="vl-table vl-table-compact vl-table-grid w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="w-10" />
                {GRID_COLS.map(c => (
                  <th key={c.key} className={`whitespace-nowrap ${c.w}`}>{c.label}</th>
                ))}
                <th className="w-56">Kiểm tra</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const p = byGridRow.get(i);
                const err = p?.errors ?? [];
                const warn = p?.warnings ?? [];
                return (
                  <tr key={i} className={err.length ? 'bg-[var(--danger-soft)]' : ''}>
                    <td className="text-center text-xs text-faint">{i + 1}</td>

                    {GRID_COLS.map((c, ci) => (
                      <td key={c.key} className={c.w}>
                        {c.key === 'loai' ? (
                          <Select
                            value={r.loai ?? ''} onChange={v => setCell(i, 'loai', v)}
                            options={ASSET_TYPES.map(t => ({ value: t, label: ASSET_TYPE_LABEL[t] }))}
                            placeholder="—" variant="bare"
                            className="w-full px-2 py-1.5 rounded-none border-0 text-xs font-bold"
                          />
                        ) : c.key === 'kho' ? (
                          <Select
                            value={r.kho ?? ''} onChange={v => setCell(i, 'kho', v)}
                            options={data.warehouses.map(w => ({
                              value: w.code,
                              label: data.zones.find(z => z.id === w.zone)?.code ?? w.code,
                            }))}
                            placeholder="—" variant="bare" searchable={data.warehouses.length > 8}
                            className="w-full px-2 py-1.5 rounded-none border-0 text-xs font-bold"
                          />
                        ) : c.key === 'ngay_kiem_dinh' ? (
                          <DatePicker value={r.ngay_kiem_dinh ?? ''}
                            onChange={v => setCell(i, 'ngay_kiem_dinh', v)}
                            bare usePortal className="w-full" />
                        ) : (
                          <input
                            type="text"
                            value={r[c.key] ?? ''}
                            onChange={e => setCell(i, c.key, e.target.value)}
                            onPaste={e => onPaste(e, i, ci)}
                            placeholder={c.key === 'ty_so' ? '2500/5' : ''}
                            className={cellCls}
                          />
                        )}
                      </td>
                    ))}

                    <td className="px-2 py-1 text-xs">
                      {err.map((e, k) => <div key={k} className="text-bad">{e}</div>)}
                      {warn.map((w, k) => <div key={k} className="text-warn">{w}</div>)}
                      {p && !err.length && !warn.length && (
                        <span className="text-[var(--success)] flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />hợp lệ
                        </span>
                      )}
                    </td>

                    <td className="text-center">
                      {rows.length > 1 && (
                        <button
                          onClick={() => setRows(prev => prev.filter((_, k) => k !== i))}
                          className="p-1 text-faint hover:text-bad transition-colors" title="Xóa dòng">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setRows(prev => [...prev, emptyRow()])}
            className="vl-btn vl-btn-secondary vl-btn-sm">
            <Plus className="w-4 h-4" />Thêm dòng
          </button>
          {parsed.length > 0 && (
            <>
              <span className="vl-badge-success text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />{good.length} dòng hợp lệ
              </span>
              {bad.length > 0 && (
                <span className="vl-badge-warning text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{bad.length} dòng lỗi — sẽ KHÔNG được ghi
                </span>
              )}
            </>
          )}
        </div>

        {result && (
          <p className="text-sm text-soft">
            Đã ghi <strong className="text-ink">{result.made}</strong> vật tư
            {result.failed > 0 && <> · <span className="text-bad">{result.failed} dòng lỗi</span></>}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="vl-btn vl-btn-secondary">Đóng</button>
          <button onClick={doImport} disabled={busy || good.length === 0}
            className="vl-btn vl-btn-primary">
            {busy ? 'Đang ghi...' : `Ghi ${good.length} vật tư vào kho`}
          </button>
        </div>
      </div>
    </div>
  );
}
