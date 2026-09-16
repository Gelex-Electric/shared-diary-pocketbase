import { useState, useMemo } from 'react';
import { AREAS } from '../../lib/pocketbase';
import { useScopeAreas, type Scope } from '../../lib/scope';
import { RefreshCw, Download, Database, Table as TableIcon, Info } from 'lucide-react';
import { DatePicker, TimePicker } from '../ui/DateTimePickers';
import { Select } from '../ui/Select';
import { toast as notify } from '../../lib/toast';
import * as XLSX from 'xlsx';
import {
  useHes30Min, toConsumptionMap, maxTotalMeterId30, toExportRow30, MISSING_LABEL,
  type MeterRow,
} from './useHes30Min';
import { HesConsumptionTable } from './HesConsumptionTable';

/* ================================================================
   Tab "Chỉ số trong 30 ngày" — đọc `public/hes_index_30min.csv`.

   Khác tab theo hóa đơn ở chỗ hai đầu kỳ là MỐC 30 PHÚT bất kỳ, không
   bắt buộc 00:00: đó là lý do lấy dữ liệu chi tiết này về.

   MỘT component cho cả hai khối (nguyên tắc 17 trong ARCHITECTURE.md):
     scope='doi'      → một bảng phẳng + bộ lọc KCN
     scope='vanphong' → mỗi KCN một bảng, xuất Excel một sheet/KCN
================================================================ */
export default function Hes30MinManager({ scope = 'doi' }: { scope?: Scope }) {
  const office = scope === 'vanphong';
  const { areas: effectiveAreas, allLabel } = useScopeAreas(scope);
  const [filterArea, setFilterArea] = useState('');

  const {
    meters, isLoading, reload,
    startDate, setStartDate, startTime, setStartTime,
    endDate, setEndDate, endTime, setEndTime,
    startTimes, endTimes, dayRange, validRange, results, missingCount,
    startAt, endAt,
  } = useHes30Min(office ? {} : { allowedAreas: effectiveAreas, filterArea });

  const consumptions = useMemo(() => toConsumptionMap(results) as any, [results]);
  const highlightId = useMemo(() => maxTotalMeterId30(meters, results), [meters, results]);

  /** Công tơ nhóm theo KCN, giữ thứ tự `AREAS` — chỉ dùng cho khối Văn phòng. */
  const metersByZone = useMemo(() => {
    const map = new Map<string, MeterRow[]>();
    for (const m of meters) {
      const z = m.area || '—';
      if (!map.has(z)) map.set(z, []);
      map.get(z)!.push(m);
    }
    return AREAS.filter(a => map.has(a)).map(a => ({ area: a, rows: map.get(a)! }));
  }, [meters]);

  const fileName = `SanLuong_30phut_${startAt.replace(/[: ]/g, '-')}_${endAt.replace(/[: ]/g, '-')}.xlsx`;

  const exportToExcel = () => {
    if (meters.length === 0) { notify.show('warning', 'Lưu ý', 'Chưa có dữ liệu để xuất'); return; }
    const wb = XLSX.utils.book_new();
    if (office) {
      for (const { area, rows } of metersByZone) {
        const ws = XLSX.utils.json_to_sheet(rows.map(m => toExportRow30(m, results.get(m.MeterNo))));
        const sheetName = area.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName || 'KCN');
      }
    } else {
      const ws = XLSX.utils.json_to_sheet(meters.map(m => toExportRow30(m, results.get(m.MeterNo))));
      XLSX.utils.book_append_sheet(wb, ws, 'SanLuong');
    }
    XLSX.writeFile(wb, fileName);
  };

  /** Mốc có thật trong ngày đang chọn — gợi ý để khỏi phải đoán. */
  const hintTimes = (list: string[]) =>
    list.length === 0 ? 'ngày này chưa có dữ liệu'
      : `${list.length} mốc · ${list[0]} → ${list[list.length - 1]}`;

  const missingLines = Object.entries(missingCount)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} công tơ: ${MISSING_LABEL[k]}`);

  return (
    <div className="space-y-6 pb-6">

      {/* Toolbar nguồn dữ liệu */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-2 text-sm text-soft">
          <Database className="w-4 h-4 text-accent" />
          <span>Nguồn: chỉ số 30 phút (CSV, giữ 30 ngày)</span>
          {dayRange.first && (
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-accent-soft text-accent">
              {dayRange.first} → {dayRange.last}
            </span>
          )}
        </div>
        <button onClick={reload} disabled={isLoading} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Tải lại
        </button>
      </div>

      <div className="vl-card overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] bg-subtle/30 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-accent rounded-lg shadow-md shadow-[var(--accent)]/20">
              <TableIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">Sản lượng giữa hai mốc 30 phút</h3>
              <p className="text-[10px] text-faint mt-0.5">Tiêu thụ = (Chỉ số mốc cuối − Chỉ số mốc đầu) × Hệ số nhân</p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 w-full xl:w-auto">
            <div className="flex items-end gap-1.5">
              <DatePicker value={startDate} onChange={setStartDate} label="Ngày đầu kỳ" className="min-w-[145px]" />
              <TimePicker value={startTime} onChange={setStartTime} label="Giờ" className="min-w-[95px]" />
            </div>
            <div className="flex items-end gap-1.5">
              <DatePicker value={endDate} onChange={setEndDate} label="Ngày cuối kỳ" className="min-w-[145px]" />
              <TimePicker value={endTime} onChange={setEndTime} label="Giờ" className="min-w-[95px]" />
            </div>
            {!office && (
              <Select
                value={filterArea}
                onChange={setFilterArea}
                options={[{ value: '', label: allLabel }, ...effectiveAreas.map(a => ({ value: a, label: a }))]}
                className="min-w-[160px]"
              />
            )}
            <button onClick={exportToExcel} disabled={meters.length === 0 || !validRange} className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
              <Download className="w-3.5 h-3.5" />
              Xuất Excel
            </button>
          </div>
        </div>

        {/* Gợi ý mốc có thật + lý do thiếu dữ liệu, thay vì để ô trống không lời giải thích */}
        <div className="px-5 py-2.5 border-b border-[var(--border)] bg-subtle/10 space-y-1">
          <p className="text-[11px] text-faint flex items-center gap-1.5">
            <Info className="w-3 h-3 shrink-0" />
            Mốc có dữ liệu — đầu kỳ: {hintTimes(startTimes)} · cuối kỳ: {hintTimes(endTimes)}
          </p>
          {!validRange && (
            <p className="text-[11px] text-[var(--danger)]">Mốc đầu kỳ phải trước mốc cuối kỳ.</p>
          )}
          {missingLines.map(line => (
            <p key={line} className="text-[11px] text-[var(--warning)]">{line}</p>
          ))}
        </div>

        {office ? (
          metersByZone.map(({ area, rows }) => (
            <div key={area} className="border-b border-[var(--border)] last:border-b-0">
              <div className="px-5 py-2 bg-subtle/30 text-xs font-bold text-ink">{area} · {rows.length} công tơ</div>
              <HesConsumptionTable rows={rows as any} consumptions={consumptions} highlightId={highlightId} />
            </div>
          ))
        ) : (
          <HesConsumptionTable
            rows={meters as any}
            consumptions={consumptions}
            highlightId={highlightId}
            status={isLoading ? 'loading' : meters.length === 0 ? 'empty' : undefined}
          />
        )}
      </div>
    </div>
  );
}
