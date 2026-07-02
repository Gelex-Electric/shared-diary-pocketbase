import { useState, useEffect, useCallback, useMemo } from 'react';
import { pb, AREAS, ID_TO_AREA } from '../../lib/pocketbase';
import { fetchMeterInfo } from '../../lib/meterInfo';
import {
  fetchHesIndex, computeConsumption,
  type HesIndexData, type Consumption,
} from '../../lib/hesIndex';
import {
  RefreshCw, Download, Database, Info, Table as TableIcon,
} from 'lucide-react';
import { DatePicker } from '../ui/DateTimePickers';
import { Select } from '../ui/Select';
import { toast as notify } from '../../lib/toast';
import * as XLSX from 'xlsx';

interface MeterRow { id: string; MeterNo: string; HSN: string; Line: string; area: string; }

const fmt = (val: number | null) =>
  val === null ? '—' : val.toLocaleString('vi-VN', { maximumFractionDigits: 0 });

/** Format "YYYY-MM-DD HH:mm:ss" → "dd/MM HH:mm" */
const fmtTime = (raw?: string): string => {
  if (!raw) return '—';
  const d = new Date(raw.replace(' ', 'T'));
  if (isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function HesDirectManager() {
  const [meters, setMeters]         = useState<MeterRow[]>([]);
  const [hesData, setHesData]       = useState<HesIndexData | null>(null);
  const [isLoading, setIsLoading]   = useState(true);
  const [filterArea, setFilterArea] = useState('');
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');

  /* ---- User areas (giống tab thủ công) ---- */
  const userAreas = useMemo(() => {
    const raw = pb.authStore.model?.area;
    const items = Array.isArray(raw)
      ? raw
      : typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
    return items.map(item => ID_TO_AREA[item] || item);
  }, [JSON.stringify(pb.authStore.model?.area)]);

  const effectiveAreas = useMemo(() => (userAreas.length > 0 ? userAreas : AREAS), [userAreas]);

  /* ---- Load meters + CSV chỉ số ---- */
  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rows, idx] = await Promise.all([fetchMeterInfo(), fetchHesIndex()]);
      const allowed = new Set(userAreas.length > 0 ? userAreas : AREAS);
      const filtered = rows
        .filter(r => r.STATUS === 'Yes')
        .filter(r => (filterArea ? r.ADDRESS === filterArea : allowed.has(r.ADDRESS)))
        .map((r): MeterRow => ({ id: r.METER_NO, MeterNo: r.METER_NO, HSN: r.METER_NAME, Line: r.LINE_NAME, area: r.ADDRESS }))
        .sort((a, b) => (a.Line + a.MeterNo).localeCompare(b.Line + b.MeterNo));
      setMeters(filtered);
      setHesData(idx);
      // Mặc định: ngày mới nhất có dữ liệu (kỳ 1 ngày)
      if (idx.dates.length > 0) {
        const last = idx.dates[idx.dates.length - 1];
        setStartDate(prev => prev || last);
        setEndDate(prev => prev || last);
      }
    } catch (err: any) {
      notify.show('error', 'Lỗi', err?.message || 'Không tải được dữ liệu chỉ số');
    } finally {
      setIsLoading(false);
    }
  }, [filterArea, userAreas]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const dateRangeHint = useMemo(() => {
    if (!hesData || hesData.dates.length === 0) return '';
    return `${hesData.dates[0]} → ${hesData.dates[hesData.dates.length - 1]}`;
  }, [hesData]);

  const validRange = startDate && endDate && startDate <= endDate;

  /* ---- Consumption per meter ---- */
  const consumptions = useMemo(() => {
    const map = new Map<string, Consumption | null>();
    if (!hesData || !validRange) return map;
    for (const m of meters) {
      map.set(m.MeterNo, computeConsumption(hesData, m.MeterNo, startDate, endDate, parseFloat(m.HSN) || 1));
    }
    return map;
  }, [hesData, meters, startDate, endDate, validRange]);

  const maxTotalMeterId = useMemo(() => {
    let bestId = ''; let best = -Infinity;
    for (const m of meters) {
      const c = consumptions.get(m.MeterNo);
      const total = c?.values.PG ?? null;
      if (total !== null && total > best) { best = total; bestId = m.id; }
    }
    return best > 0 ? bestId : '';
  }, [meters, consumptions]);

  /* ---- Export Excel ---- */
  const exportToExcel = () => {
    const rows = meters.map(m => {
      const c = consumptions.get(m.MeterNo);
      return {
        'Số công tơ':        m.MeterNo,
        'Trạm':              m.Line || '',
        'Hệ số nhân':        m.HSN || '',
        'Thời gian đầu kỳ':  fmtTime(c?.startTime),
        'Thời gian cuối kỳ': fmtTime(c?.endTime),
        'Tổng (kWh)':        c?.values.PG ?? '',
        'Biểu 1 (kWh)':      c?.values.BT ?? '',
        'Biểu 2 (kWh)':      c?.values.CD ?? '',
        'Biểu 3 (kWh)':      c?.values.TD ?? '',
        'Vô công (kVarh)':   c?.values.VC ?? '',
      };
    });
    if (rows.length === 0) { notify.show('warning', 'Lưu ý', 'Chưa có dữ liệu để xuất'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
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
        <button onClick={loadAll} disabled={isLoading} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
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
              options={[{ value: '', label: 'Tất cả khu vực' }, ...effectiveAreas.map(a => ({ value: a, label: a }))]}
              className="min-w-[160px]"
            />
            <button onClick={exportToExcel} disabled={meters.length === 0 || !validRange} className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
              <Download className="w-3.5 h-3.5" />
              Xuất Excel
            </button>
          </div>
        </div>

        {!isLoading && hesData && hesData.dates.length === 0 && (
          <div className="flex items-center gap-2 px-5 py-3 text-xs text-soft bg-subtle/50">
            <Info className="w-3.5 h-3.5 shrink-0" />
            Chưa có dữ liệu chỉ số tự động — workflow “Fetch HES Index” cần chạy ít nhất một lần.
          </div>
        )}
        {!isLoading && hesData && hesData.dates.length > 0 && !validRange && (
          <div className="flex items-center gap-2 px-5 py-3 text-xs text-warn bg-[var(--warning-soft)]">
            <Info className="w-3.5 h-3.5 shrink-0" />
            Khoảng ngày không hợp lệ — ngày đầu kỳ phải nhỏ hơn hoặc bằng ngày cuối kỳ.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left border-collapse">
            <thead>
              <tr>
                <th>Số công tơ</th>
                <th>Trạm</th>
                <th className="text-center">Hệ số nhân</th>
                <th className="text-center">Thời gian đầu kỳ</th>
                <th className="text-center">Thời gian cuối kỳ</th>
                <th className="text-center text-ink font-bold border-x border-[var(--border)]">Tổng (kWh)</th>
                <th className="text-center">Biểu 1 (kWh)</th>
                <th className="text-center">Biểu 2 (kWh)</th>
                <th className="text-center">Biểu 3 (kWh)</th>
                <th className="text-center">Vô công (kVarh)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? (
                <tr><td colSpan={10} className="py-10 text-center"><RefreshCw className="w-5 h-5 animate-spin text-faint mx-auto" /></td></tr>
              ) : meters.length === 0 ? (
                <tr><td colSpan={10} className="py-10 text-center text-faint text-sm italic">Không có dữ liệu công tơ</td></tr>
              ) : (
                meters.map(m => {
                  const c = consumptions.get(m.MeterNo);
                  const isMax = m.id === maxTotalMeterId;
                  return (
                    <tr key={m.id} className={`transition-colors ${isMax ? 'bg-[var(--warning-soft)] hover:bg-[var(--warning-soft)]' : 'hover:bg-subtle'}`}>
                      <td>
                        <span className="font-mono text-xs font-bold text-accent bg-accent-soft px-2 py-1 rounded">{m.MeterNo}</span>
                      </td>
                      <td className="text-sm text-soft">{m.Line || '—'}</td>
                      <td className="text-center text-xs font-mono text-soft">{m.HSN || '1'}</td>
                      <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">{fmtTime(c?.startTime)}</td>
                      <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">{fmtTime(c?.endTime)}</td>
                      <td className="text-center text-sm font-extrabold text-ink border-x border-[var(--border)]">{fmt(c?.values.PG ?? null)}</td>
                      <td className="text-center text-xs font-bold text-accent">{fmt(c?.values.BT ?? null)}</td>
                      <td className="text-center text-xs font-bold text-orange-500">{fmt(c?.values.CD ?? null)}</td>
                      <td className="text-center text-xs font-bold text-purple-500">{fmt(c?.values.TD ?? null)}</td>
                      <td className="text-center text-xs font-bold text-soft">{fmt(c?.values.VC ?? null)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
