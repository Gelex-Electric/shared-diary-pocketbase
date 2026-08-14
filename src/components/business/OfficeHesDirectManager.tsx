import { useMemo } from 'react';
import { AREAS } from '../../lib/pocketbase';
import { kcnColorOf } from '../../lib/kcnColors';
import { RefreshCw, Download, Database, Table as TableIcon } from 'lucide-react';
import { DatePicker } from '../ui/DateTimePickers';
import { toast as notify } from '../../lib/toast';
import * as XLSX from 'xlsx';
import {
  useHesConsumption, maxTotalMeterId, toExportRow, type MeterRow,
} from '../hes/useHesConsumption';
import { HesConsumptionTable, HesRangeNotices } from '../hes/HesConsumptionTable';

/* ================================================================
   HES "Lấy trực tiếp" — bản khối Văn phòng.
   Đọc CSV chỉ số (hes_index_daily), hiển thị NHIỀU bảng: mỗi KCN 1 bảng.
   Khoảng ngày dùng chung; xuất Excel 1 sheet/KCN.

   Dùng chung useHesConsumption + HesConsumptionTable với bản khối Vận
   hành (hes/HesDirectManager.tsx); chỉ khác bố cục và cách xuất Excel.
================================================================ */
export default function OfficeHesDirectManager() {
  const {
    meters, hesData, isLoading, reload,
    startDate, setStartDate, endDate, setEndDate,
    validRange, dateRangeHint, consumptions,
  } = useHesConsumption(); // không truyền allowedAreas: Văn phòng xem hết

  /** Công tơ nhóm theo KCN, giữ thứ tự AREAS. */
  const metersByZone = useMemo(() => {
    const map = new Map<string, MeterRow[]>();
    for (const m of meters) {
      const z = m.area || '—';
      if (!map.has(z)) map.set(z, []);
      map.get(z)!.push(m);
    }
    return AREAS.filter(a => map.has(a)).map(a => ({ area: a, rows: map.get(a)! }));
  }, [meters]);

  const exportToExcel = () => {
    if (meters.length === 0) { notify.show('warning', 'Lưu ý', 'Chưa có dữ liệu để xuất'); return; }
    const wb = XLSX.utils.book_new();
    for (const { area, rows } of metersByZone) {
      const ws = XLSX.utils.json_to_sheet(rows.map(m => toExportRow(m, consumptions.get(m.MeterNo))));
      // Tên sheet ≤ 31 ký tự, bỏ ký tự cấm
      const sheetName = area.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName || 'KCN');
    }
    XLSX.writeFile(wb, `SanLuong_HES_${startDate}_${endDate}.xlsx`);
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Toolbar chung */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-2 text-sm text-soft">
          <Database className="w-4 h-4 text-accent" />
          <span>Nguồn: chỉ số tự động (CSV)</span>
          {dateRangeHint && (
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-accent-soft text-accent">{dateRangeHint}</span>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DatePicker value={startDate} onChange={setStartDate} label="Từ ngày (đầu kỳ)" className="min-w-[150px]" />
          <DatePicker value={endDate}   onChange={setEndDate}   label="Đến ngày (cuối kỳ)" className="min-w-[150px]" />
          <button onClick={exportToExcel} disabled={meters.length === 0 || !validRange} className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> Xuất Excel
          </button>
          <button onClick={reload} disabled={isLoading} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Tải lại
          </button>
        </div>
      </div>

      <HesRangeNotices
        isLoading={isLoading}
        hasDates={hesData ? hesData.dates.length > 0 : null}
        validRange={validRange}
        rounded
      />

      {isLoading ? (
        <div className="vl-card flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-faint" />
        </div>
      ) : metersByZone.length === 0 ? (
        <div className="vl-card flex items-center justify-center py-16 text-faint text-sm italic">Không có dữ liệu công tơ</div>
      ) : (
        metersByZone.map(({ area, rows }) => {
          const c = kcnColorOf(area);
          return (
            <div key={area} className="vl-card overflow-hidden">
              <div className={`px-5 py-3 border-b border-[var(--border)] flex items-center gap-2.5 ${c.bg}`}>
                <div className="p-2 bg-accent rounded-lg"><TableIcon className="w-4 h-4 text-white" /></div>
                <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                <h3 className={`text-sm font-bold ${c.text}`}>{area}</h3>
                <span className="text-xs font-semibold text-soft">· {rows.length} công tơ</span>
              </div>
              {/* Tô nổi bật công tơ tổng lớn nhất TRONG TỪNG KCN (khác bản Vận hành: lớn nhất toàn bảng) */}
              <HesConsumptionTable
                rows={rows}
                consumptions={consumptions}
                highlightId={maxTotalMeterId(rows, consumptions)}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
