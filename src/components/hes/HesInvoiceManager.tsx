import { useState, useEffect, useCallback, useMemo } from 'react';
import { AREAS } from '../../lib/pocketbase';
import { useScopeAreas, type Scope } from '../../lib/scope';
import { zoneOf, ZONE_MAP } from '../../lib/invoices';
import { RefreshCw, Download, FileText, Table as TableIcon, Layers } from 'lucide-react';
import { MonthPicker } from '../ui/DateTimePickers';
import { Select } from '../ui/Select';
import { toast as notify } from '../../lib/toast';
import * as XLSX from 'xlsx';
import {
  fetchInvoiceIndexMonth, latestInvoiceMonth, INVOICE_COMPONENTS,
  type InvoiceIndexRow,
} from '../../lib/hesInvoiceIndex';
import { ZoneTables, type ZoneGroup } from '../dm/ZoneTables';

/* ================================================================
   Tab "Chỉ số theo hóa đơn" — đọc collection `invoice`.

   Đây là chỉ số CÓ GIÁ TRỊ PHÁP LÝ: màn "Biên bản xác nhận chỉ số"
   ghi vào đó. Khác tab 30 phút ở chỗ kỳ là KỲ HÓA ĐƠN, không phải
   khoảng người dùng tự chọn.

   MỘT component cho cả hai khối qua prop `scope` (nguyên tắc 17):
     scope='doi'      → có thêm bộ lọc KCN (thường chỉ một KCN)
     scope='vanphong' → xem hết, Excel một sheet mỗi KCN

   Bảng bày thành THẺ THU GỌN theo KCN, dùng lại `ZoneTables` của màn
   Danh mục để hai nơi không mỗi nơi một kiểu.
================================================================ */

const fmt = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
/** Chỉ số thô để nguyên phần thập phân — đây là con số trên biên bản. */
const fmtIdx = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });

const toExportRow = (r: InvoiceIndexRow) => {
  const row: Record<string, any> = {
    'Số công tơ': r.sct,
    'Mã khách hàng': r.mkh,
    'Khách hàng': r.customer,
    'Hệ số nhân': r.hsn,
    'Từ ngày': r.startDate,
    'Đến ngày': r.endDate,
  };
  for (const c of INVOICE_COMPONENTS) {
    row[`${c.label} đầu kỳ`] = r.index[c.key]?.dau ?? '';
    row[`${c.label} cuối kỳ`] = r.index[c.key]?.cuoi ?? '';
    row[`${c.label} (${c.unit})`] = r.values[c.key] ?? '';
  }
  row['Tổng (kWh)'] = r.total ?? '';
  row['Ghi chú'] = r.merged ? 'Gộp từ nhiều khoảng đổi giá' : '';
  return row;
};

export default function HesInvoiceManager({ scope = 'doi' }: { scope?: Scope }) {
  const office = scope === 'vanphong';
  const { areas: effectiveAreas, allLabel } = useScopeAreas(scope);
  const [filterArea, setFilterArea] = useState('');

  const [month, setMonth] = useState('');
  const [rows, setRows] = useState<InvoiceIndexRow[]>([]);
  const [isLoading, setLoading] = useState(true);

  /* Mở màn ra là có số: lấy tháng gần nhất có hóa đơn, không phải tháng hiện tại. */
  useEffect(() => {
    let ok = true;
    latestInvoiceMonth()
      .then(ym => { if (ok && ym) setMonth(p => p || ym); })
      .catch(() => {})
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    try {
      setRows(await fetchInvoiceIndexMonth(month));
    } catch (err: any) {
      notify.show('error', 'Lỗi', err?.message || 'Không tải được chỉ số theo hóa đơn');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { reload(); }, [reload]);

  /*
    Lọc theo KCN: `invoice` không có cột KCN, nhưng mã khách hàng mang tiền tố
    khu — `zoneOf` + `ZONE_MAP` đã làm sẵn phép suy đó cho các màn Kinh doanh.
  */
  const areaOf = (r: InvoiceIndexRow) => ZONE_MAP[zoneOf(r.mkh)] ?? '';
  const visible = useMemo(() => {
    const allowed = office ? null : new Set(effectiveAreas);
    return rows.filter(r => {
      const a = areaOf(r);
      if (filterArea) return a === filterArea;
      return office || !allowed || allowed.has(a);
    });
  }, [rows, office, effectiveAreas, filterArea]);

  /** Nhóm theo KCN, giữ thứ tự `AREAS`; kỳ chưa suy được KCN gom vào thẻ cuối. */
  const zoneGroups = useMemo((): ZoneGroup<InvoiceIndexRow>[] => {
    const map = new Map<string, InvoiceIndexRow[]>();
    for (const r of visible) {
      const z = areaOf(r) || '';
      if (!map.has(z)) map.set(z, []);
      map.get(z)!.push(r);
    }
    const known = AREAS.filter(a => map.has(a))
      .map(a => ({ zone: { id: a, name: a }, rows: map.get(a)! }));
    return map.has('') ? [...known, { zone: null, rows: map.get('')! }] : known;
  }, [visible]);

  const exportToExcel = () => {
    if (visible.length === 0) { notify.show('warning', 'Lưu ý', 'Chưa có dữ liệu để xuất'); return; }
    const wb = XLSX.utils.book_new();
    if (office) {
      for (const { zone, rows: rs } of zoneGroups) {
        const ws = XLSX.utils.json_to_sheet(rs.map(toExportRow));
        XLSX.utils.book_append_sheet(wb, ws,
          (zone?.name ?? 'Chua gan KCN').replace(/[\\/?*[\]:]/g, '').slice(0, 31));
      }
    } else {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visible.map(toExportRow)), 'ChiSo');
    }
    XLSX.writeFile(wb, `ChiSo_HoaDon_${month}.xlsx`);
  };

  return (
    <div className="space-y-6 pb-6">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-2 text-sm text-soft">
          <FileText className="w-4 h-4 text-accent" />
          <span>Nguồn: chỉ số trên hóa đơn (PocketBase) — số liệu có giá trị pháp lý</span>
        </div>
        <button onClick={reload} disabled={isLoading} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Tải lại
        </button>
      </div>

      <div className="vl-card overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] bg-subtle/30 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-accent rounded-lg shadow-md shadow-[var(--accent)]/20">
              <TableIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">Chỉ số theo kỳ hóa đơn</h3>
              <p className="text-[10px] text-faint mt-0.5">
                Sản lượng = (Chỉ số cuối kỳ − Chỉ số đầu kỳ) × Hệ số nhân · {visible.length} công tơ
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 w-full lg:w-auto">
            <MonthPicker value={month} onChange={setMonth} label="Kỳ hóa đơn" className="min-w-[150px]" />
            {!office && (
              <Select
                value={filterArea}
                onChange={setFilterArea}
                options={[{ value: '', label: allLabel }, ...effectiveAreas.map(a => ({ value: a, label: a }))]}
                className="min-w-[160px]"
              />
            )}
            <button onClick={exportToExcel} disabled={visible.length === 0} className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
              <Download className="w-3.5 h-3.5" />
              Xuất Excel
            </button>
          </div>
        </div>

      </div>

      {/*
        Mỗi KCN một thẻ thu gọn được — cùng khuôn với bảng Danh mục
        (`ZoneTables`), kèm phân trang 50 dòng/thẻ có sẵn.
      */}
      <ZoneTables
        groups={zoneGroups}
        unit="công tơ"
        loading={isLoading}
        empty="Tháng này chưa có hóa đơn nào"
        minWidth={980}
        columns={<>
          <th>Số công tơ</th>
          <th>Khách hàng</th>
          <th className="text-center">HSN</th>
          <th className="text-center">Kỳ hóa đơn</th>
          {INVOICE_COMPONENTS.map(c => (
            <th key={c.key} className="text-center">{c.label} đầu → cuối</th>
          ))}
          <th className="text-center border-x border-[var(--border)]">Tổng (kWh)</th>
        </>}
        rowKey={r => `${r.sct}-${r.startDate}`}
        renderRow={r => (
          <tr className="hover:bg-subtle transition-colors">
            <td>
              <span className="font-mono text-xs font-bold text-accent bg-accent-soft px-2 py-1 rounded">{r.sct}</span>
              {r.merged && (
                <span title="Gộp từ nhiều khoảng đổi giá" className="ml-1.5 inline-flex align-middle text-[var(--warning)]">
                  <Layers className="w-3 h-3" />
                </span>
              )}
            </td>
            <td className="text-sm text-soft truncate" title={r.customer}>{r.customer || '—'}</td>
            <td className="text-center text-xs font-mono text-soft">{r.hsn}</td>
            <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">
              {r.startDate} → {r.endDate}
            </td>
            {INVOICE_COMPONENTS.map(c => (
              <td key={c.key} className="text-center text-[11px] font-mono text-soft whitespace-nowrap">
                <span className="text-faint">{fmtIdx(r.index[c.key]?.dau ?? null)}</span>
                {' → '}
                <span className="text-ink">{fmtIdx(r.index[c.key]?.cuoi ?? null)}</span>
                <div className="text-[10px] font-bold text-accent">{fmt(r.values[c.key] ?? null)}</div>
              </td>
            ))}
            <td className="text-center text-sm font-extrabold text-ink border-x border-[var(--border)]">{fmt(r.total)}</td>
          </tr>
        )}
      />
    </div>
  );
}
