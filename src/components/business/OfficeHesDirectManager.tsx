import { useState, useEffect, useCallback, useMemo } from 'react';
import { AREAS } from '../../lib/pocketbase';
import { kcnColorOf } from '../../lib/kcnColors';
import { fetchMeterInfo } from '../../lib/meterInfo';
import {
  fetchHesIndex, computeConsumption,
  type HesIndexData, type Consumption,
} from '../../lib/hesIndex';
import { RefreshCw, Download, Database, Info, Table as TableIcon } from 'lucide-react';
import { DatePicker } from '../ui/DateTimePickers';
import { toast as notify } from '../../lib/toast';
import * as XLSX from 'xlsx';

interface MeterRow { id: string; MeterNo: string; HSN: string; Line: string; area: string; }

const fmt = (val: number | null) =>
  val === null ? '—' : val.toLocaleString('vi-VN', { maximumFractionDigits: 0 });

const fmtTime = (raw?: string): string => {
  if (!raw) return '—';
  const d = new Date(raw.replace(' ', 'T'));
  if (isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ================================================================
   HES "Lấy trực tiếp" — bản khối Văn phòng.
   Đọc CSV chỉ số (hes_index_daily), hiển thị NHIỀU bảng: mỗi KCN 1 bảng.
   Khoảng ngày dùng chung; xuất Excel 1 sheet/KCN.
================================================================ */
export default function OfficeHesDirectManager() {
  const [meters, setMeters]       = useState<MeterRow[]>([]);
  const [hesData, setHesData]     = useState<HesIndexData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rows, idx] = await Promise.all([fetchMeterInfo(), fetchHesIndex()]);
      const filtered = rows
        .filter(r => r.STATUS === 'Yes')
        .map((r): MeterRow => ({ id: r.METER_NO, MeterNo: r.METER_NO, HSN: r.METER_NAME, Line: r.LINE_NAME, area: r.ADDRESS }))
        .sort((a, b) => (a.Line + a.MeterNo).localeCompare(b.Line + b.MeterNo));
      setMeters(filtered);
      setHesData(idx);
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
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const dateRangeHint = useMemo(() => {
    if (!hesData || hesData.dates.length === 0) return '';
    return `${hesData.dates[0]} → ${hesData.dates[hesData.dates.length - 1]}`;
  }, [hesData]);

  const validRange = !!(startDate && endDate && startDate <= endDate);

  const consumptions = useMemo(() => {
    const map = new Map<string, Consumption | null>();
    if (!hesData || !validRange) return map;
    for (const m of meters) {
      map.set(m.MeterNo, computeConsumption(hesData, m.MeterNo, startDate, endDate, parseFloat(m.HSN) || 1));
    }
    return map;
  }, [hesData, meters, startDate, endDate, validRange]);

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
      const data = rows.map(m => {
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
      const ws = XLSX.utils.json_to_sheet(data);
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
          <button onClick={loadAll} disabled={isLoading} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Tải lại
          </button>
        </div>
      </div>

      {!isLoading && hesData && hesData.dates.length === 0 && (
        <div className="flex items-center gap-2 px-5 py-3 text-xs text-soft bg-subtle/50 rounded-lg">
          <Info className="w-3.5 h-3.5 shrink-0" />
          Chưa có dữ liệu chỉ số tự động — workflow “Fetch HES Index” cần chạy ít nhất một lần.
        </div>
      )}
      {!isLoading && hesData && hesData.dates.length > 0 && !validRange && (
        <div className="flex items-center gap-2 px-5 py-3 text-xs text-warn bg-[var(--warning-soft)] rounded-lg">
          <Info className="w-3.5 h-3.5 shrink-0" />
          Khoảng ngày không hợp lệ — ngày đầu kỳ phải nhỏ hơn hoặc bằng ngày cuối kỳ.
        </div>
      )}

      {isLoading ? (
        <div className="vl-card flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-faint" />
        </div>
      ) : metersByZone.length === 0 ? (
        <div className="vl-card flex items-center justify-center py-16 text-faint text-sm italic">Không có dữ liệu công tơ</div>
      ) : (
        metersByZone.map(({ area, rows }) => {
          const c = kcnColorOf(area);
          // Công tơ có tổng lớn nhất trong KCN → tô nổi bật
          let maxId = ''; let best = -Infinity;
          for (const m of rows) {
            const total = consumptions.get(m.MeterNo)?.values.PG ?? null;
            if (total !== null && total > best) { best = total; maxId = m.id; }
          }
          return (
            <div key={area} className="vl-card overflow-hidden">
              <div className={`px-5 py-3 border-b border-[var(--border)] flex items-center gap-2.5 ${c.bg}`}>
                <div className="p-2 bg-accent rounded-lg"><TableIcon className="w-4 h-4 text-white" /></div>
                <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                <h3 className={`text-sm font-bold ${c.text}`}>{area}</h3>
                <span className="text-xs font-semibold text-soft">· {rows.length} công tơ</span>
              </div>
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
                    {rows.map(m => {
                      const cs = consumptions.get(m.MeterNo);
                      const isMax = m.id === maxId;
                      return (
                        <tr key={m.id} className={`transition-colors ${isMax ? 'bg-[var(--warning-soft)] hover:bg-[var(--warning-soft)]' : 'hover:bg-subtle'}`}>
                          <td><span className="font-mono text-xs font-bold text-accent bg-accent-soft px-2 py-1 rounded">{m.MeterNo}</span></td>
                          <td className="text-sm text-soft">{m.Line || '—'}</td>
                          <td className="text-center text-xs font-mono text-soft">{m.HSN || '1'}</td>
                          <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">{fmtTime(cs?.startTime)}</td>
                          <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">{fmtTime(cs?.endTime)}</td>
                          <td className="text-center text-sm font-extrabold text-ink border-x border-[var(--border)]">{fmt(cs?.values.PG ?? null)}</td>
                          <td className="text-center text-xs font-bold text-accent">{fmt(cs?.values.BT ?? null)}</td>
                          <td className="text-center text-xs font-bold text-orange-500">{fmt(cs?.values.CD ?? null)}</td>
                          <td className="text-center text-xs font-bold text-purple-500">{fmt(cs?.values.TD ?? null)}</td>
                          <td className="text-center text-xs font-bold text-soft">{fmt(cs?.values.VC ?? null)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
