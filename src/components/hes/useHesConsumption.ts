import { useState, useEffect, useCallback, useMemo } from 'react';
import { loadCatalog } from '../../lib/dm/repo';
import { hesMeterRowsOf } from '../../lib/dm/meterRows';
import {
  fetchHesIndexBounds, fetchHesIndexDays, computeConsumption,
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
  /** Ngày cũ nhất/mới nhất có chỉ số — để đặt mặc định và hiện khoảng tra được. */
  const [bounds, setBounds]       = useState<{ first: string; last: string }>({ first: '', last: '' });
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

        CHỈ SỐ đo đếm cũng chuyển sang PocketBase (user chốt 16/09/2026): file
        `hes_index_daily.csv` nằm trong `public/` nên ai biết URL đều tải được
        toàn bộ số liệu mà không cần đăng nhập. Ở đây chỉ lấy MỐC ngày có dữ
        liệu; bản thân chỉ số tải sau, theo đúng kỳ người dùng chọn.
      */
      const [cat, bounds] = await Promise.all([loadCatalog(), fetchHesIndexBounds()]);
      const rows = hesMeterRowsOf(cat);
      const allowed = allowedAreas ? new Set(allowedAreas) : null;
      const filtered = rows
        .filter(r => (filterArea ? r.ADDRESS === filterArea : (!allowed || allowed.has(r.ADDRESS))))
        .map((r): MeterRow => ({ id: r.METER_NO, MeterNo: r.METER_NO, HSN: r.METER_NAME, Line: r.LINE_NAME, area: r.ADDRESS }))
        .sort((a, b) => (a.Line + a.MeterNo).localeCompare(b.Line + b.MeterNo));
      setMeters(filtered);
      setBounds(bounds);
      // Mặc định: ngày mới nhất có dữ liệu (kỳ 1 ngày)
      if (bounds.last) {
        setStartDate(prev => prev || bounds.last);
        setEndDate(prev => prev || bounds.last);
      }
    } catch (err: any) {
      notify.show('error', 'Lỗi', err?.message || 'Không tải được dữ liệu chỉ số');
    } finally {
      setIsLoading(false);
    }
  }, [filterArea, allowedAreas]);

  useEffect(() => { reload(); }, [reload]);

  const dateRangeHint = useMemo(
    () => (bounds.first && bounds.last ? `${bounds.first} → ${bounds.last}` : ''),
    [bounds]);

  const validRange = !!(startDate && endDate && startDate <= endDate);

  /*
    Tải chỉ số của ĐÚNG hai ngày đầu/cuối kỳ mỗi khi người dùng đổi kỳ.
    `computeConsumption` chỉ cần hai dòng đó, nên không có lý do gì tải cả kho.
  */
  useEffect(() => {
    if (!validRange) { setHesData(null); return; }
    let ok = true;
    setIsLoading(true);
    fetchHesIndexDays([startDate, endDate])
      .then(d => { if (ok) setHesData(d); })
      .catch(err => {
        if (ok) notify.show('error', 'Lỗi', err?.message || 'Không tải được chỉ số');
      })
      .finally(() => { if (ok) setIsLoading(false); });
    return () => { ok = false; };
  }, [startDate, endDate, validRange]);

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
