import { useState, useEffect, useCallback, useMemo } from 'react';
import { loadCatalog } from '../../lib/dm/repo';
import { hesMeterRowsOf } from '../../lib/dm/meterRows';
import {
  fetchHes30, consumptionBetween, dayRangeOf, timesOfDay, stampOf,
  type Hes30Data, type Result30,
} from '../../lib/hes30min';
import { toast as notify } from '../../lib/toast';

export interface MeterRow { id: string; MeterNo: string; HSN: string; Line: string; area: string; }

export interface UseHes30MinOptions {
  /** Chỉ lấy công tơ thuộc các KCN này. `undefined` = không giới hạn (khối Văn phòng). */
  allowedAreas?: string[];
  /** KCN đang chọn ở bộ lọc. Rỗng = không lọc thêm. */
  filterArea?: string;
}

/**
 * Nạp danh sách công tơ + file chỉ số 30 phút, rồi tính sản lượng giữa HAI MỐC
 * người dùng chọn (ngày + giờ).
 *
 * Danh sách công tơ lấy từ DANH MỤC PocketBase như các màn HES khác — chỉ số
 * thì đọc file CSV do pipeline chốt (user chốt 16/09/2026: PocketBase giữ dữ
 * liệu nghiệp vụ, CSV giữ số liệu thô của pipeline).
 *
 * Toàn bộ file tải MỘT lần rồi tra trong bộ nhớ: 30 ngày ≈ 11,7 MB thô, ~2,1 MB
 * sau nén. Đổi mốc không phải tải lại.
 */
export function useHes30Min({ allowedAreas, filterArea = '' }: UseHes30MinOptions = {}) {
  const [meters, setMeters]   = useState<MeterRow[]>([]);
  const [data, setData]       = useState<Hes30Data | null>(null);
  const [isLoading, setLoad]  = useState(true);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('00:00');
  const [endDate, setEndDate]     = useState('');
  const [endTime, setEndTime]     = useState('00:00');

  const reload = useCallback(async () => {
    setLoad(true);
    try {
      const [cat, idx] = await Promise.all([loadCatalog(), fetchHes30()]);
      const rows = hesMeterRowsOf(cat);
      const allowed = allowedAreas ? new Set(allowedAreas) : null;
      setMeters(rows
        .filter(r => (filterArea ? r.ADDRESS === filterArea : (!allowed || allowed.has(r.ADDRESS))))
        .map((r): MeterRow => ({
          id: r.METER_NO, MeterNo: r.METER_NO, HSN: r.METER_NAME,
          Line: r.LINE_NAME, area: r.ADDRESS,
        }))
        .sort((a, b) => (a.Line + a.MeterNo).localeCompare(b.Line + b.MeterNo)));
      setData(idx);

      /*
        Mặc định: kỳ MỘT NGÀY mới nhất — 00:00 ngày cuối → 00:00 hôm sau không
        có trong file, nên lấy 00:00 ngày áp chót → 00:00 ngày cuối.
      */
      const { first, last } = dayRangeOf(idx);
      if (last) {
        const prev = new Date(`${last}T00:00:00`);
        prev.setDate(prev.getDate() - 1);
        const prevStr = prev.toISOString().slice(0, 10);
        setStartDate(p => p || (prevStr >= first ? prevStr : last));
        setEndDate(p => p || last);
      }
    } catch (err: any) {
      notify.show('error', 'Lỗi', err?.message || 'Không tải được chỉ số 30 phút');
    } finally {
      setLoad(false);
    }
  }, [filterArea, allowedAreas]);

  useEffect(() => { reload(); }, [reload]);

  const dayRange = useMemo(() => (data ? dayRangeOf(data) : { first: '', last: '' }), [data]);
  const startTimes = useMemo(() => (data ? timesOfDay(data, startDate) : []), [data, startDate]);
  const endTimes   = useMemo(() => (data ? timesOfDay(data, endDate) : []), [data, endDate]);

  const startAt = stampOf(startDate, startTime);
  const endAt   = stampOf(endDate, endTime);
  const validRange = !!(startAt && endAt && startAt < endAt);

  const results = useMemo(() => {
    const map = new Map<string, Result30>();
    if (!data || !validRange) return map;
    for (const m of meters) {
      map.set(m.MeterNo, consumptionBetween(data, m.MeterNo, startAt, endAt, parseFloat(m.HSN) || 1));
    }
    return map;
  }, [data, meters, startAt, endAt, validRange]);

  return {
    meters, isLoading, reload,
    startDate, setStartDate, startTime, setStartTime,
    endDate, setEndDate, endTime, setEndTime,
    startTimes, endTimes, dayRange, validRange, results,
  };
}
