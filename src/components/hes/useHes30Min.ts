import { useState, useEffect, useCallback, useMemo } from 'react';
import { loadCatalog } from '../../lib/dm/repo';
import { hesMeterRowsOf } from '../../lib/dm/meterRows';
import {
  fetchHes30Index, fetchHes30Days, consumptionBetween, timesOfDay, stampOf,
  type Hes30Data, type Hes30Index, type Result30,
} from '../../lib/hes30min';
import { toast as notify } from '../../lib/toast';

export type { MeterRow } from './hesShared';
import type { MeterRow } from './hesShared';

/** Công tơ tiêu thụ lớn nhất, để tô nổi bật. '' nếu chưa có số nào. */
export function maxTotalMeterId30(rows: MeterRow[], results: Map<string, Result30>): string {
  let bestId = ''; let best = -Infinity;
  for (const m of rows) {
    const total = results.get(m.MeterNo)?.value?.values.PG ?? null;
    if (total !== null && total > best) { best = total; bestId = m.id; }
  }
  return best > 0 ? bestId : '';
}

/** Một dòng cho file Excel. Giữ đúng bộ cột của tab cũ để người dùng quen mắt. */
export const toExportRow30 = (m: MeterRow, r?: Result30) => ({
  'Số công tơ':        m.MeterNo,
  'Trạm':              m.Line || '',
  'Hệ số nhân':        m.HSN || '',
  'Mốc đầu kỳ':        r?.value?.startAt ?? '',
  'Mốc cuối kỳ':       r?.value?.endAt ?? '',
  'Tổng (kWh)':        r?.value?.values.PG ?? '',
  'Biểu 1 (kWh)':      r?.value?.values.BT ?? '',
  'Biểu 2 (kWh)':      r?.value?.values.CD ?? '',
  'Biểu 3 (kWh)':      r?.value?.values.TD ?? '',
  'Vô công (kVarh)':   r?.value?.values.VC ?? '',
  'Ghi chú':           MISSING_LABEL[r?.missing ?? ''] ?? '',
});

/** Lý do không tính được, nói bằng tiếng người. */
export const MISSING_LABEL: Record<string, string> = {
  'no-meter': 'Không có dữ liệu đo xa trong kho 30 ngày',
  'no-start': 'Thiếu bản ghi tại mốc đầu kỳ',
  'no-end':   'Thiếu bản ghi tại mốc cuối kỳ',
};

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
 * Tải theo NGÀY: lượt đầu chỉ lấy danh mục ngày (~1 KB), rồi mỗi lần đổi ngày
 * tải đúng 2 file của hai đầu kỳ (~770 KB). Đổi GIỜ không phải tải lại vì cả
 * ngày đã nằm trong bộ nhớ.
 */
export function useHes30Min({ allowedAreas, filterArea = '' }: UseHes30MinOptions = {}) {
  const [meters, setMeters]   = useState<MeterRow[]>([]);
  const [index, setIndex]     = useState<Hes30Index>({ days: [], first: '', last: '' });
  const [data, setData]       = useState<Hes30Data | null>(null);
  const [isLoading, setLoad]  = useState(true);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('00:00');
  const [endDate, setEndDate]     = useState('');
  const [endTime, setEndTime]     = useState('00:00');

  /*
    Lượt tải đầu chỉ lấy DANH MỤC NGÀY (~1 KB) + danh sách công tơ. Chỉ số của
    từng ngày tải sau, theo đúng kỳ người dùng chọn — xem effect bên dưới.
  */
  const reload = useCallback(async () => {
    setLoad(true);
    try {
      const [cat, idx] = await Promise.all([loadCatalog(), fetchHes30Index()]);
      const rows = hesMeterRowsOf(cat);
      /* Tên TẮT khách hàng: bảng hẹp, tên đầy đủ đẩy các cột số ra ngoài màn hình. */
      const shortOf = new Map(cat.customers.map(c => [c.mkh, c.short_name || c.name]));
      const allowed = allowedAreas ? new Set(allowedAreas) : null;
      setMeters(rows
        .filter(r => (filterArea ? r.ADDRESS === filterArea : (!allowed || allowed.has(r.ADDRESS))))
        .map((r): MeterRow => ({
          id: r.METER_NO, MeterNo: r.METER_NO, HSN: r.METER_NAME,
          Line: r.LINE_NAME, area: r.ADDRESS,
          Customer: shortOf.get(r.CUSTOMER_CODE) || r.CUSTOMER_NAME,
        }))
        .sort((a, b) => (a.Line + a.MeterNo).localeCompare(b.Line + b.MeterNo)));
      setIndex(idx);

      /* Mặc định: kỳ MỘT NGÀY mới nhất — 00:00 ngày áp chót → 00:00 ngày cuối. */
      if (idx.days.length) {
        const last = idx.days[idx.days.length - 1];
        const prev = idx.days[idx.days.length - 2] ?? last;
        setStartDate(p => p || prev);
        setEndDate(p => p || last);
      }
    } catch (err: any) {
      notify.show('error', 'Lỗi', err?.message || 'Không tải được chỉ số 30 phút');
    } finally {
      setLoad(false);
    }
  }, [filterArea, allowedAreas]);

  useEffect(() => { reload(); }, [reload]);

  /*
    Đổi ngày thì tải lại đúng file của hai ngày đó. Kỳ dài bao nhiêu cũng chỉ
    cần hai đầu mút, nên luôn là 2 file — đây chính là lý do tách file theo ngày.
  */
  useEffect(() => {
    if (!startDate && !endDate) return;
    let ok = true;
    fetchHes30Days([startDate, endDate])
      .then(d => { if (ok) setData(d); })
      .catch(err => {
        if (ok) notify.show('error', 'Lỗi', err?.message || 'Không tải được chỉ số 30 phút');
      });
    return () => { ok = false; };
  }, [startDate, endDate]);

  const dayRange = useMemo(() => ({ first: index.first, last: index.last }), [index]);
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

  /** Đếm công tơ theo từng lý do thiếu, để màn hình báo gọn một dòng. */
  const missingCount = useMemo(() => {
    const c = { 'no-meter': 0, 'no-start': 0, 'no-end': 0 } as Record<string, number>;
    for (const r of results.values()) if (r.missing) c[r.missing]++;
    return c;
  }, [results]);

  return {
    /** Dữ liệu thô đang giữ — bảng cần để hiện chỉ số đầu/cuối dưới mỗi ô số. */
    data,
    meters, isLoading, reload,
    startDate, setStartDate, startTime, setStartTime,
    endDate, setEndDate, endTime, setEndTime,
    startTimes, endTimes, dayRange, validRange, results, missingCount,
    startAt, endAt,
  };
}
