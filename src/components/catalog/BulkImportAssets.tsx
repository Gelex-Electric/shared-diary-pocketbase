import { useState, useMemo } from 'react';
import { X, Download, AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { pb } from '../../lib/pocketbase';
import { toast as notify } from '../../lib/toast';
import { type CatalogData, ASSET_TYPE_LABEL } from '../../lib/catalog';
import { parseAssets, templateCsv, type ParsedRow } from '../../lib/assetImport';

/**
 * Nhập hàng loạt vật tư bằng cách dán từ Excel (task 8).
 *
 * Chỉ ghi các dòng HỢP LỆ; dòng lỗi giữ nguyên trên màn hình kèm lý do theo
 * từng dòng để người dùng sửa rồi dán lại — không im lặng bỏ qua.
 */
export default function BulkImportAssets({
  data, onClose, onDone,
}: { data: CatalogData; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [docNo, setDocNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ made: number; failed: number } | null>(null);

  const rows = useMemo(() => (text.trim() ? parseAssets(text, data) : []), [text, data]);
  const good = rows.filter(r => r.errors.length === 0);
  const bad = rows.filter(r => r.errors.length > 0);
  const today = new Date().toISOString().slice(0, 10);

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + templateCsv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mau-nhap-vat-tu.csv';
    a.click();
    URL.revokeObjectURL(a.href);
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
      onDone();
    }
    if (failed > 0) notify.show('error', 'Có dòng ghi lỗi', `${failed} dòng`);
  };

  const RowLine = ({ r }: { r: ParsedRow }) => (
    <tr className={r.errors.length ? 'bg-[var(--danger-soft)]' : ''}>
      <td className="px-2 py-1 text-faint">{r.line}</td>
      <td className="px-2 py-1 font-mono text-xs">{r.serial || '—'}</td>
      <td className="px-2 py-1">{r.type ? ASSET_TYPE_LABEL[r.type] : '—'}</td>
      <td className="px-2 py-1 font-mono text-xs">{r.ratio ? `${r.ratio_primary}/${r.ratio_secondary} = ${r.ratio}` : '—'}</td>
      <td className="px-2 py-1">{r.manufacture_year ?? '—'}</td>
      <td className="px-2 py-1 text-xs">{r.next_calibration ?? '—'}</td>
      <td className="px-2 py-1">{r.warehouseCode ?? '—'}</td>
      <td className="px-2 py-1 text-xs">
        {r.errors.map((e, i) => <div key={i} className="text-bad">{e}</div>)}
        {r.warnings.map((w, i) => <div key={i} className="text-warn">{w}</div>)}
      </td>
    </tr>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="vl-card w-full max-w-5xl max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-ink">Nhập hàng loạt vật tư</h3>
            <p className="text-sm text-soft mt-1">
              Dán trực tiếp từ Excel (mỗi dòng một vật tư). Chỉ những dòng hợp lệ mới được ghi.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-faint hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <button onClick={downloadTemplate} className="flex items-center gap-2 px-3 py-2 rounded border border-[var(--border)] text-sm font-semibold text-soft hover:bg-subtle transition-colors">
            <Download className="w-4 h-4" />Tải file mẫu
          </button>
          <label className="block">
            <span className="text-xs font-semibold text-soft">Ngày nhập kho *</span>
            <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)}
              className="mt-1 block px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-soft">Số biên bản / phiếu nhập</span>
            <input type="text" value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="VD: PN-2026-07"
              className="mt-1 block px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none" />
          </label>
        </div>

        <div>
          <p className="text-xs text-faint mb-1">
            Cột: <code className="font-mono">so_hieu, loai, so_cap, thu_cap, hang_sx, model, cap_chinh_xac, nam_sx, ngay_kiem_dinh, kho, ghi_chu</code>
            {' '}— loại nhận CONGTO / TI / TU / GP03 / KHAC. Có hàng tiêu đề hay không đều được.
          </p>
          <textarea
            value={text} onChange={e => { setText(e.target.value); setResult(null); }}
            rows={7} placeholder={'TI-2026-001\tTI\t800\t5\tEMIC\t\t0.5\t2026\t\t809\t'}
            className="w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm font-mono focus:ring-2 focus:ring-accent outline-none"
          />
        </div>

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="vl-badge-success font-bold px-2 py-1 rounded flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />{good.length} dòng hợp lệ
              </span>
              {bad.length > 0 && (
                <span className="vl-badge-warning font-bold px-2 py-1 rounded flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{bad.length} dòng lỗi — sẽ KHÔNG được ghi
                </span>
              )}
            </div>

            <div className="border border-[var(--border)] rounded overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-subtle sticky top-0">
                  <tr className="text-left text-xs text-soft">
                    <th className="px-2 py-1">Dòng</th><th className="px-2 py-1">Số hiệu</th>
                    <th className="px-2 py-1">Loại</th><th className="px-2 py-1">Tỷ số</th>
                    <th className="px-2 py-1">Năm SX</th><th className="px-2 py-1">Hạn KĐ</th>
                    <th className="px-2 py-1">Kho</th><th className="px-2 py-1">Ghi chú kiểm tra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.map(r => <RowLine key={r.line} r={r} />)}
                </tbody>
              </table>
            </div>
          </>
        )}

        {result && (
          <p className="text-sm text-dim">
            Đã ghi <strong className="text-ink">{result.made}</strong> vật tư
            {result.failed > 0 && <> · <strong className="text-bad">{result.failed}</strong> dòng ghi lỗi</>}.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded text-sm font-semibold text-soft border border-[var(--border)] hover:bg-subtle transition-colors disabled:opacity-50">
            Đóng
          </button>
          <button onClick={doImport} disabled={busy || good.length === 0 || date > today}
            className="px-4 py-2 rounded text-sm font-bold bg-accent text-[var(--on-accent)] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2">
            <Upload className="w-4 h-4" />
            {busy ? 'Đang ghi...' : `Nhập kho ${good.length} vật tư`}
          </button>
        </div>
      </div>
    </div>
  );
}
