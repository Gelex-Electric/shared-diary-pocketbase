import { useState, useEffect, useCallback, useMemo } from 'react';
import { pb } from '../../lib/pocketbase';
import { fetchMeterInfo } from '../../lib/meterInfo';
import { AccountHes, DataMetter } from '../../types';
import type { Consumption } from '../../lib/hesIndex';
import { toast as notify, type ToastType } from '../../lib/toast';
import type { MeterRow } from './useHesConsumption';

const TOAST_TITLE: Record<ToastType, string> = {
  success: 'Thành công', error: 'Lỗi', warning: 'Lưu ý', info: 'Thông báo', alert: 'Thông báo',
};

export interface ReadingData {
  meterNo: string;
  pg: string; bt: string; cd: string; td: string; vc: string;
  recordTime?: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  errorMsg?: string;
}

export interface ReadingSection {
  id: number;
  date: string;   // "YYYY-MM-DD"
  time: string;   // "HH:mm"
  readings: Record<string, ReadingData>;
}

type Field = 'pg' | 'bt' | 'cd' | 'td' | 'vc';

/* ---- Default dates: đầu kỳ hôm qua, cuối kỳ hôm nay ---- */
const _now       = new Date();
const _yesterday = new Date(_now);
_yesterday.setDate(_yesterday.getDate() - 1);
const pad2 = (n: number) => String(n).padStart(2, '0');
const todayStr     = `${_now.getFullYear()}-${pad2(_now.getMonth() + 1)}-${pad2(_now.getDate())}`;
const yesterdayStr = `${_yesterday.getFullYear()}-${pad2(_yesterday.getMonth() + 1)}-${pad2(_yesterday.getDate())}`;
const defaultTime  = '00:00';

/** Build "yyyyMMddHHmmss" cho HES API (giờ local) */
function toHesDateStr(date: string, time: string, offsetMinutes = 0): string {
  const d = new Date(`${date}T${time}:00`);
  d.setMinutes(d.getMinutes() + offsetMinutes);
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}00`
  );
}

export interface UseHesManualReadingsOptions {
  /** Chỉ lấy công tơ thuộc các KCN này. `undefined` = không giới hạn (khối Văn phòng). */
  allowedAreas?: string[];
  /** KCN đang chọn ở bộ lọc. Rỗng = không lọc thêm. */
  filterArea?: string;
  /**
   * Tài khoản HES nào được dùng:
   *  - mảng KCN  → lấy bản ghi AccountHes đầu tiên khớp một trong các KCN đó (khối Vận hành).
   *  - undefined → lấy bản ghi đầu tiên, một token dùng chung (khối Văn phòng).
   */
  accountAreas?: string[];
}

/**
 * Lấy chỉ số tức thời từ HES cho 2 thời điểm (đầu kỳ / cuối kỳ) rồi tính
 * tiêu thụ = (cuối − đầu) × HSN.
 *
 * Tách từ phần trùng nhau của HesManualManager (khối Vận hành) và
 * OfficeHesManualManager (khối Văn phòng) — hai màn chỉ khác BỐ CỤC
 * (bảng phẳng vs nhóm theo KCN) và tài khoản HES dùng để lấy token.
 */
export function useHesManualReadings({
  allowedAreas, filterArea = '', accountAreas,
}: UseHesManualReadingsOptions = {}) {
  const [meters, setMeters]                   = useState<MeterRow[]>([]);
  const [isLoadingMeters, setIsLoadingMeters] = useState(true);
  const [hesAccount, setHesAccount]           = useState<AccountHes | null>(null);
  const [isGettingToken, setIsGettingToken]   = useState(false);

  const [sections, setSections] = useState<ReadingSection[]>([
    { id: 1, date: yesterdayStr, time: defaultTime, readings: {} }, // Đầu kỳ: hôm qua
    { id: 2, date: todayStr,     time: defaultTime, readings: {} }, // Cuối kỳ: hôm nay
  ]);

  const showToast = useCallback((msg: string, type: ToastType = 'info') => {
    notify.show(type, TOAST_TITLE[type], msg);
  }, []);

  /* ---- Tài khoản HES ---- */
  useEffect(() => {
    if (!accountAreas) {
      pb.collection('AccountHes').getList<AccountHes>(1, 1)
        .then(res => setHesAccount(res.items[0] || null))
        .catch(() => {});
      return;
    }
    if (accountAreas.length === 0) return;
    const areaFilter = accountAreas.map(a => `area='${a.replace(/'/g, "\\'")}'`).join('||');
    pb.collection('AccountHes')
      .getFirstListItem<AccountHes>(`(${areaFilter})`)
      .then(setHesAccount)
      .catch(() => {});
  }, [accountAreas]);

  const getToken = async () => {
    if (!hesAccount) { showToast('Không tìm thấy tài khoản HES.', 'error'); return; }
    setIsGettingToken(true);
    try {
      const res = await fetch(`/hes/api/Login?UserAccount=${hesAccount.Account}&Password=${hesAccount.Password}`);
      if (!res.ok) throw new Error('Lỗi kết nối API');
      const data = await res.json();
      if (data?.TOKEN) {
        const updated = await pb.collection('AccountHes').update(hesAccount.id, { Token: data.TOKEN });
        setHesAccount(updated as any);
        showToast('Lấy Token thành công!', 'success');
      } else {
        throw new Error('Không nhận được Token');
      }
    } catch (err: any) {
      showToast('Lỗi lấy Token: ' + err.message, 'error');
    } finally {
      setIsGettingToken(false);
    }
  };

  /* ---- Danh sách công tơ (từ metterinfo.csv) ---- */
  const loadMeters = useCallback(async () => {
    setIsLoadingMeters(true);
    try {
      const rows = await fetchMeterInfo();
      const allowed = allowedAreas ? new Set(allowedAreas) : null;
      const filtered = rows
        .filter(r => r.STATUS === 'Yes')
        .filter(r => (filterArea ? r.ADDRESS === filterArea : (!allowed || allowed.has(r.ADDRESS))))
        .map((r): MeterRow => ({ id: r.METER_NO, MeterNo: r.METER_NO, HSN: r.METER_NAME, Line: r.LINE_NAME, area: r.ADDRESS }))
        .sort((a, b) => (a.Line + a.MeterNo).localeCompare(b.Line + b.MeterNo));
      setMeters(filtered);
    } catch (err: any) {
      console.error('Error loading meters:', err);
    } finally {
      setIsLoadingMeters(false);
    }
  }, [filterArea, allowedAreas]);

  useEffect(() => { loadMeters(); }, [loadMeters]);

  const updateDate = (id: number, val: string) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, date: val } : s));

  const updateTime = (id: number, val: string) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, time: val } : s));

  /* ================================================================
     Lấy chỉ số cho MỘT mốc thời gian (API: GetMeterDataByDate)
     Gọi theo lô 3 công tơ, nghỉ 500ms giữa các lô để không dội API.
  ================================================================ */
  const fetchSection = async (sectionId: number) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section || meters.length === 0) return;

    if (!section.date || !section.time) {
      showToast('Vui lòng chọn ngày và giờ lấy chỉ số', 'warning');
      return;
    }

    /* Khởi tạo loading */
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const init: Record<string, ReadingData> = {};
      meters.forEach(m => {
        init[m.MeterNo] = {
          meterNo: m.MeterNo, pg: '-', bt: '-', cd: '-', td: '-', vc: '-',
          status: 'loading',
        };
      });
      return { ...s, readings: init };
    }));

    const token   = hesAccount?.Token ?? '';
    const reqTime = new Date(`${section.date}T${section.time}:00`).getTime();
    const batchSize = 3;

    /** Bản ghi có DATE_TIME gần mốc yêu cầu nhất, bỏ các bản ghi chỉ số 0. */
    const pickNearest = (data: unknown): DataMetter | undefined => {
      if (!Array.isArray(data) || data.length === 0) return undefined;
      return (data as DataMetter[])
        .filter(r => parseFloat(r.ACTIVE_KW_INDICATE_TOTAL) > 0)
        .sort((a, b) =>
          Math.abs(new Date(a.DATE_TIME).getTime() - reqTime) -
          Math.abs(new Date(b.DATE_TIME).getTime() - reqTime)
        )[0];
    };

    /** URL đọc chỉ số 1 công tơ, cửa sổ [mốc, mốc + endOffsetMinutes]. */
    const hesUrl = (meterNo: string, endOffsetMinutes: number) => {
      const sStart = toHesDateStr(section.date, section.time);
      const sEnd   = toHesDateStr(section.date, section.time, endOffsetMinutes);
      return `/hes/api/GetMeterDataByDate?MeterNo=${meterNo}&StartDate=${sStart}&EndDate=${sEnd}&Token=${token}`;
    };

    for (let i = 0; i < meters.length; i += batchSize) {
      const batch = meters.slice(i, i + batchSize);

      await Promise.all(batch.map(async (meter) => {
        let record: DataMetter | undefined;

        try {
          /* --- Lần 1: cửa sổ +35 phút --- */
          const res1 = await fetch(hesUrl(meter.MeterNo, 35));
          if (res1.ok) {
            const data1 = await res1.json();
            if (!Array.isArray(data1) && (data1 as any)?.MESSAGE === 'invalid token') {
              throw new Error('Token HES hết hạn');
            }
            record = pickNearest(data1);
          }

          /* --- Fallback: cửa sổ +120 phút --- */
          if (!record) {
            const res2 = await fetch(hesUrl(meter.MeterNo, 120));
            if (res2.ok) record = pickNearest(await res2.json());
          }

          /* --- Cập nhật state --- */
          setSections(prev => prev.map(s => {
            if (s.id !== sectionId) return s;
            return {
              ...s,
              readings: {
                ...s.readings,
                [meter.MeterNo]: record
                  ? {
                      meterNo:    meter.MeterNo,
                      pg:         record.ACTIVE_KW_INDICATE_TOTAL     || '0',
                      bt:         record.ACTIVE_KW_INDICATE_RATE1     || '0',
                      cd:         record.ACTIVE_KW_INDICATE_RATE2     || '0',
                      td:         record.ACTIVE_KW_INDICATE_RATE3     || '0',
                      vc:         record.REACTIVE_KVAR_INDICATE_TOTAL || '0',
                      recordTime: record.DATE_TIME,
                      status:     'success',
                    }
                  : {
                      ...s.readings[meter.MeterNo],
                      status:   'error',
                      errorMsg: 'Không tìm thấy dữ liệu',
                    },
              },
            };
          }));

        } catch (err: any) {
          if (err.message === 'Token HES hết hạn') {
            showToast('Token HES hết hạn — vui lòng lấy token mới', 'error');
            setSections(prev => prev.map(s => {
              if (s.id !== sectionId) return s;
              const updated = { ...s.readings };
              meters.forEach(m => {
                if (updated[m.MeterNo]?.status === 'loading')
                  updated[m.MeterNo] = { ...updated[m.MeterNo], status: 'error', errorMsg: 'Token hết hạn' };
              });
              return { ...s, readings: updated };
            }));
            return;
          }
          setSections(prev => prev.map(s => {
            if (s.id !== sectionId) return s;
            return {
              ...s,
              readings: {
                ...s.readings,
                [meter.MeterNo]: {
                  ...s.readings[meter.MeterNo],
                  status:   'error',
                  errorMsg: 'Lỗi kết nối',
                },
              },
            };
          }));
        }
      }));

      await new Promise(r => setTimeout(r, 500));
    }
  };

  /**
   * Quy tiêu thụ về đúng kiểu `Consumption` của lib/hesIndex để dùng lại
   * `HesConsumptionTable` và `toExportRow` chung với tab "Lấy trực tiếp".
   */
  const consumptions = useMemo(() => {
    const map = new Map<string, Consumption | null>();
    for (const m of meters) {
      const r1 = sections[0].readings[m.MeterNo];
      const r2 = sections[1].readings[m.MeterNo];
      const hsn = parseFloat(m.HSN) || 1;
      const calc = (field: Field): number | null => {
        if (r1?.status !== 'success' || r2?.status !== 'success') return null;
        const v1 = parseFloat(r1[field]);
        const v2 = parseFloat(r2[field]);
        if (isNaN(v1) || isNaN(v2)) return null;
        return Math.round((v2 - v1) * hsn);
      };
      map.set(m.MeterNo, {
        startTime: r1?.recordTime ?? '',
        endTime:   r2?.recordTime ?? '',
        hsn,
        values: { PG: calc('pg'), BT: calc('bt'), CD: calc('cd'), TD: calc('td'), VC: calc('vc') },
      });
    }
    return map;
  }, [meters, sections]);

  return {
    meters, isLoadingMeters,
    hesAccount, getToken, isGettingToken,
    sections, updateDate, updateTime, fetchSection,
    consumptions, showToast,
  };
}
