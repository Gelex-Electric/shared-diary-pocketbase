import { useMemo } from 'react';
import { AREAS } from '../../lib/pocketbase';
import { kcnColorOf } from '../../lib/kcnColors';
import { RefreshCw, Download, Zap, Table as TableIcon, CreditCard } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toExportRow, type MeterRow } from '../hes/useHesConsumption';
import { useHesManualReadings } from '../hes/useHesManualReadings';
import { HesManualSectionCards } from '../hes/HesManualSectionCards';
import { HesConsumptionTable } from '../hes/HesConsumptionTable';

/* ================================================================
   HES "Lấy thủ công" — bản khối Văn phòng.
   Dùng 1 tài khoản HES của khối Văn phòng (1 token chung cho mọi KCN).
   Hai bảng lấy chỉ số nhóm hàng theo KCN; bảng chi tiết sản lượng tách
   thành N bảng theo KCN.

   Dùng chung useHesManualReadings + các component con với bản khối Vận
   hành (hes/HesManualManager.tsx); chỉ khác bố cục và cách xuất Excel.
================================================================ */
export default function OfficeHesManualManager() {
  const {
    meters, isLoadingMeters,
    hesAccount, getToken, isGettingToken,
    sections, updateDate, updateTime, fetchSection,
    consumptions, showToast,
  } = useHesManualReadings(); // không truyền allowedAreas/accountAreas: Văn phòng xem hết, token chung

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
    if (meters.length === 0) { showToast('Chưa có dữ liệu để xuất', 'warning'); return; }
    const wb = XLSX.utils.book_new();
    for (const { area, rows } of metersByZone) {
      const ws = XLSX.utils.json_to_sheet(rows.map(m => toExportRow(m, consumptions.get(m.MeterNo))));
      const sheetName = area.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName || 'KCN');
    }
    XLSX.writeFile(wb, `SanLuong_HES_${Date.now()}.xlsx`);
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Toolbar Token */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-2 text-sm text-soft">
          <Zap className="w-4 h-4 text-accent" />
          <span>Token HES (khối Văn phòng):</span>
          <span className={`font-mono text-xs px-2 py-0.5 rounded ${hesAccount?.Token ? 'bg-[var(--success-soft)] text-ok' : 'bg-[var(--danger-soft)] text-red-500'}`}>
            {hesAccount?.Token ? hesAccount.Token.slice(0, 20) + '…' : 'Chưa có token'}
          </span>
        </div>
        <button onClick={getToken} disabled={isGettingToken || !hesAccount} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
          {isGettingToken ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
          {isGettingToken ? 'Đang lấy...' : 'Lấy Token'}
        </button>
      </div>

      {/* 2 bảng lấy chỉ số (đầu kỳ / cuối kỳ), hàng nhóm theo KCN */}
      <HesManualSectionCards
        sections={sections}
        meters={meters}
        zones={metersByZone}
        isLoadingMeters={isLoadingMeters}
        onDateChange={updateDate}
        onTimeChange={updateTime}
        onFetch={fetchSection}
      />

      {/* Chi tiết sản lượng — tách theo KCN */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-accent rounded-lg shadow-md shadow-[var(--accent)]/20">
            <TableIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-ink">Chi tiết sản lượng theo KCN</h3>
            <p className="text-[10px] text-faint mt-0.5">Tiêu thụ = (Cuối kỳ − Đầu kỳ) × Hệ số nhân</p>
          </div>
        </div>
        <button onClick={exportToExcel} disabled={meters.length === 0} className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /> Xuất Excel
        </button>
      </div>

      {isLoadingMeters ? (
        <div className="vl-card flex items-center justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-faint" /></div>
      ) : metersByZone.length === 0 ? (
        <div className="vl-card flex items-center justify-center py-16 text-faint text-sm italic">Không có dữ liệu công tơ</div>
      ) : (
        metersByZone.map(({ area, rows }) => {
          const c = kcnColorOf(area);
          return (
            <div key={area} className="vl-card overflow-hidden">
              <div className={`px-5 py-3 border-b border-[var(--border)] flex items-center gap-2.5 ${c.bg}`}>
                <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                <h3 className={`text-sm font-bold ${c.text}`}>{area}</h3>
                <span className="text-xs font-semibold text-soft">· {rows.length} công tơ</span>
              </div>
              {/* Bản Văn phòng KHÔNG tô nổi bật công tơ lớn nhất (khác bản Vận hành) */}
              <HesConsumptionTable rows={rows} consumptions={consumptions} />
            </div>
          );
        })
      )}
    </div>
  );
}
