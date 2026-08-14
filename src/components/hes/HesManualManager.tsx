import { useState, useMemo } from 'react';
import { useScopeAreas, useUserAreas, type Scope } from '../../lib/scope';
import { RefreshCw, Download, Zap, Table as TableIcon, CreditCard } from 'lucide-react';
import { Select } from '../ui/Select';
import * as XLSX from 'xlsx';
import { maxTotalMeterId, toExportRow } from './useHesConsumption';
import { useHesManualReadings } from './useHesManualReadings';
import { HesManualSectionCards } from './HesManualSectionCards';
import { HesConsumptionTable } from './HesConsumptionTable';

/* ================================================================
   HES "Lấy chỉ số thủ công" — bản khối Vận hành.
   Token lấy từ tài khoản HES của chính KCN đang đăng nhập; một bảng
   chi tiết sản lượng phẳng, xuất Excel một sheet.
   Bản khối Văn phòng ở business/OfficeHesManualManager.tsx dùng chung
   hook + các component con.
================================================================ */
export default function HesManualManager({ scope = 'doi' }: { scope?: Scope }) {
  const { areas: effectiveAreas, allLabel } = useScopeAreas(scope);
  // Tài khoản HES tra theo KCN THẬT của user (không fallback về toàn bộ AREAS
  // như effectiveAreas) — giữ đúng hành vi cũ: user không có KCN thì không tra.
  const userAreas = useUserAreas();
  const [filterArea, setFilterArea] = useState('');

  const {
    meters, isLoadingMeters,
    hesAccount, getToken, isGettingToken,
    sections, updateDate, updateTime, fetchSection,
    consumptions, showToast,
  } = useHesManualReadings({
    allowedAreas: effectiveAreas,
    filterArea,
    accountAreas: userAreas,
  });

  /* Công tơ có sản lượng Tổng (kWh) lớn nhất — để đánh dấu trong bảng chi tiết */
  const highlightId = useMemo(
    () => maxTotalMeterId(meters, consumptions), [meters, consumptions]);

  const exportToExcel = () => {
    if (meters.length === 0) { showToast('Chưa có dữ liệu để xuất', 'warning'); return; }
    const ws = XLSX.utils.json_to_sheet(meters.map(m => toExportRow(m, consumptions.get(m.MeterNo))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SanLuong');
    XLSX.writeFile(wb, `SanLuong_HES_${Date.now()}.xlsx`);
  };

  return (
    <div className="space-y-6 pb-6">

      {/* Toolbar: Lấy Token */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-2 text-sm text-soft">
          <Zap className="w-4 h-4 text-accent" />
          <span>Token HES:</span>
          <span className={`font-mono text-xs px-2 py-0.5 rounded ${hesAccount?.Token ? 'bg-[var(--success-soft)] text-ok' : 'bg-[var(--danger-soft)] text-red-500'}`}>
            {hesAccount?.Token ? hesAccount.Token.slice(0, 20) + '…' : 'Chưa có token'}
          </span>
        </div>
        <button
          onClick={getToken}
          disabled={isGettingToken || !hesAccount}
          className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50"
        >
          {isGettingToken
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            : <CreditCard className="w-3.5 h-3.5" />}
          {isGettingToken ? 'Đang lấy...' : 'Lấy Token'}
        </button>
      </div>

      {/* Hai thẻ đầu kỳ / cuối kỳ */}
      <HesManualSectionCards
        sections={sections}
        meters={meters}
        isLoadingMeters={isLoadingMeters}
        onDateChange={updateDate}
        onTimeChange={updateTime}
        onFetch={fetchSection}
      />

      {/* Chi tiết sản lượng (Cuối kỳ − Đầu kỳ) */}
      <div className="vl-card overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] bg-subtle/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-accent rounded-lg shadow-md shadow-[var(--accent)]/20">
              <TableIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">Chi tiết sản lượng</h3>
              <p className="text-[10px] text-faint mt-0.5">Tiêu thụ = (Cuối kỳ − Đầu kỳ) × Hệ số nhân</p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={exportToExcel}
              disabled={meters.length === 0}
              className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              Xuất Excel
            </button>
            <Select
              value={filterArea}
              onChange={setFilterArea}
              options={[{ value: '', label: allLabel }, ...effectiveAreas.map(a => ({ value: a, label: a }))]}
              className="min-w-[170px]"
            />
          </div>
        </div>

        <HesConsumptionTable
          rows={meters}
          consumptions={consumptions}
          highlightId={highlightId}
          status={isLoadingMeters ? 'loading' : meters.length === 0 ? 'empty' : undefined}
        />
      </div>
    </div>
  );
}
