import { useState, useEffect, useCallback, useMemo } from 'react';
import { loadCatalog } from '../../lib/dm/repo';
import { hesMeterRowsOf } from '../../lib/dm/meterRows';
import {
  fetchHesIndex, computeConsumption,
  type HesIndexData, type Consumption,
} from '../../lib/hesIndex';
import { toast as notify } from '../../lib/toast';

export interface MeterRow { id: string; MeterNo: string; HSN: string; Line: string; area: string; }

/** Số → chuỗi kiểu Việt Nam, `null` thành gạch ngang. */
export const fmt = (val: number | null) =>
  val === null ? '—' : val.toLocaleString('vi-VN', { maximumFractionDigits: 0 });

/** Format "YYYY-MM-DD HH:mm:ss" → "dd/MM HH:mm" */
export const fmtTime = (raw?: string): string => {
  if (!raw) return '—';
  const d = new Date(raw.replace(' ', 'T'));
  if (isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Một dòng cho file Excel xuất ra. Dùng chung để 2 khối xuất cùng bộ cột. */
export const toExportRow = (m: MeterRow, c?: Consumption | null) => ({
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
});

/** Id công tơ có tổng tiêu thụ lớn nhất trong danh sách (để tô nổi bật). '' nếu không có. */
export function maxTotalMeterId(
  rows: MeterRow[],
  consumptions: Map<string, Consumption | null>,
): string {
  let bestId = ''; let best = -Infinity;
  for (const m of rows) {
    const total = consumptions.get(m.MeterNo)?.values.PG ?? null;
    if (total !== null && total > best) { best = total; bestId = m.id; }
  }
  return best > 0 ? bestId : '';
}

export interface UseHesConsumptionOptions {
  /**
   * Chỉ lấy công tơ thuộc các KCN này. `undefined` = không giới hạn
   * (khối Văn phòng xem hết). Mảng phải ổn định giữa các lần render —
   * `useScopeAreas` đã memo sẵn.
   */
  allowedAreas?: string[];
  /** KCN đang chọn ở bộ lọc. Rỗng = không lọc thêm. */
  filterArea?: string;
}

/**
 * Nạp danh sách công tơ + CSV chỉ số HES, rồi tính tiêu thụ theo khoảng ngày.
 *
 * Tách từ phần trùng nhau của HesDirectManager (khối Vận hành) và
 * OfficeHesDirectManager (khối Văn phòng): hai màn khác nhau ở BỐ CỤC
 * (một bảng phẳng vs mỗi KCN một bảng) chứ không khác ở cách lấy số.
 */
export function useHesConsumption({ allowedAreas, filterArea = '' }: UseHesConsumptionOptions = {}) {
  const [meters, setMeters]       = useState<MeterRow[]>([]);
  const [hesData, setHesData]     = useState<HesIndexData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      /*
        Danh sách công tơ lấy từ DANH MỤC trên PocketBase, không còn đọc
        `metterinfo.csv` (user chốt 04/09/2026) — CSV là bản kết xuất từ HES
        chạy hằng đêm nên trễ một ngày và không biết gì về những gì vừa khai.

        `hes_index_daily.csv` thì GIỮ NGUYÊN: đó là CHỈ SỐ đo đếm do pipeline
        chốt mỗi ngày, không phải danh mục.
      */
      const [cat, idx] = await Promise.all([loadCatalog(), fetchHesIndex()]);
      const rows = hesMeterRowsOf(cat);
      const allowed = allowedAreas ? new Set(allowedAreas) : null;
      const filtered = rows
        .filter(r => (filterArea ? r.ADDRESS === filterArea : (!allowed || allowed.has(r.ADDRESS))))
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
  }, [filterArea, allowedAreas]);

  useEffect(() => { reload(); }, [reload]);

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

  return {
    meters, hesData, isLoading, reload,
    startDate, setStartDate, endDate, setEndDate,
    validRange, dateRangeHint, consumptions,
  };
}
