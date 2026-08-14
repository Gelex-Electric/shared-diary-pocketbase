import { useState, useMemo } from 'react';
import { useScopeAreas, type Scope } from '../../lib/scope';
import { RefreshCw, Download, Database, Table as TableIcon } from 'lucide-react';
import { DatePicker } from '../ui/DateTimePickers';
import { Select } from '../ui/Select';
import { toast as notify } from '../../lib/toast';
import * as XLSX from 'xlsx';
import { useHesConsumption, maxTotalMeterId, toExportRow } from './useHesConsumption';
import { HesConsumptionTable, HesRangeNotices } from './HesConsumptionTable';

/* ================================================================
   HES "Lấy trực tiếp" — bản khối Vận hành.
   Đọc CSV chỉ số (hes_index_daily), MỘT bảng phẳng cho các KCN của
   tài khoản; xuất Excel một sheet. Bản khối Văn phòng ở
   business/OfficeHesDirectManager.tsx dùng chung hook + bảng.
================================================================ */
export default function HesDirectManager({ scope = 'doi' }: { scope?: Scope }) {
  // Bộ chọn KCN ở màn này LUÔN hiện (khác CustomerManager) — giữ nguyên hành vi cũ.
  const { areas: effectiveAreas, allLabel } = useScopeAreas(scope);
  const [filterArea, setFilterArea] = useState('');

  const {
    meters, hesData, isLoading, reload,
    startDate, setStartDate, endDate, setEndDate,
    validRange, dateRangeHint, consumptions,
  } = useHesConsumption({ allowedAreas: effectiveAreas, filterArea });

  const highlightId = useMemo(
    () => maxTotalMeterId(meters, consumptions), [meters, consumptions]);

  const exportToExcel = () => {
    if (meters.length === 0) { notify.show('warning', 'Lưu ý', 'Chưa có dữ liệu để xuất'); return; }
    const ws = XLSX.utils.json_to_sheet(meters.map(m => toExportRow(m, consumptions.get(m.MeterNo))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SanLuong');
    XLSX.writeFile(wb, `SanLuong_HES_${startDate}_${endDate}.xlsx`);
  };

  return (
    <div className="space-y-6 pb-6">

      {/* Toolbar nguồn dữ liệu */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-2 text-sm text-soft">
          <Database className="w-4 h-4 text-accent" />
          <span>Nguồn: chỉ số tự động (CSV)</span>
          {dateRangeHint && (
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-accent-soft text-accent">{dateRangeHint}</span>
          )}
        </div>
        <button onClick={reload} disabled={isLoading} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Tải lại
        </button>
      </div>

      {/* Bảng sản lượng theo khoảng ngày */}
      <div className="vl-card overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] bg-subtle/30 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-accent rounded-lg shadow-md shadow-[var(--accent)]/20">
              <TableIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">Sản lượng theo khoảng ngày</h3>
              <p className="text-[10px] text-faint mt-0.5">Tiêu thụ = (Chỉ số cuối kỳ − Chỉ số đầu kỳ) × Hệ số nhân</p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 w-full lg:w-auto">
            <DatePicker value={startDate} onChange={setStartDate} label="Từ ngày (đầu kỳ)" className="min-w-[150px]" />
            <DatePicker value={endDate}   onChange={setEndDate}   label="Đến ngày (cuối kỳ)" className="min-w-[150px]" />
            <Select
              value={filterArea}
              onChange={setFilterArea}
              options={[{ value: '', label: allLabel }, ...effectiveAreas.map(a => ({ value: a, label: a }))]}
              className="min-w-[160px]"
            />
            <button onClick={exportToExcel} disabled={meters.length === 0 || !validRange} className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
              <Download className="w-3.5 h-3.5" />
              Xuất Excel
            </button>
          </div>
        </div>

        <HesRangeNotices
          isLoading={isLoading}
          hasDates={hesData ? hesData.dates.length > 0 : null}
          validRange={validRange}
        />

        <HesConsumptionTable
          rows={meters}
          consumptions={consumptions}
          highlightId={highlightId}
          status={isLoading ? 'loading' : meters.length === 0 ? 'empty' : undefined}
        />
      </div>
    </div>
  );
}
