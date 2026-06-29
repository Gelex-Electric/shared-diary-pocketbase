import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, ID_TO_AREA } from '../lib/pocketbase';
import { fetchMeterInfo } from '../lib/meterInfo';
import { AccountHes, DataMetter } from '../types';

interface MeterRow { id: string; MeterNo: string; HSN: string; Line: string; area: string; }
import {
  RefreshCw, Download, Zap, X,
  CheckCircle2, XCircle, AlertCircle, Info,
  Table as TableIcon, CreditCard, Crown,
} from 'lucide-react';
import { DatePicker, TimePicker } from './ui/DateTimePickers';
import { toast as notify, type ToastType } from '../lib/toast';

const TOAST_TITLE: Record<ToastType, string> = {
  success: 'Thành công', error: 'Lỗi', warning: 'Lưu ý', info: 'Thông báo', alert: 'Thông báo',
};
import { Select } from './ui/Select';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';

/* ================================================================
   TYPES
================================================================ */
interface ReadingData {
  meterNo: string;
  pg: string;
  bt: string;
  cd: string;
  td: string;
  vc: string;
  recordTime?: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  errorMsg?: string;
}

interface ReadingSection {
  id: number;
  date: string;   // "YYYY-MM-DD"
  time: string;   // "HH:mm"
  readings: Record<string, ReadingData>;
}

/* ---- Default dates ---- */
const _now       = new Date();
const _yesterday = new Date(_now);
_yesterday.setDate(_yesterday.getDate() - 1);
const _pad = (n: number) => String(n).padStart(2, '0');
const todayStr     = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
const yesterdayStr = `${_yesterday.getFullYear()}-${_pad(_yesterday.getMonth() + 1)}-${_pad(_yesterday.getDate())}`;
const defaultTime  = '00:00';

/* ---- Helpers ---- */
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Build "yyyyMMddHHmmss" cho HES API (giờ local) */
function toHesDateStr(date: string, time: string, offsetMinutes = 0): string {
  const d = new Date(`${date}T${time}:00`);
  d.setMinutes(d.getMinutes() + offsetMinutes);
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}00`
  );
}

/** Format DATE_TIME → "dd/MM HH:mm" theo giờ local (HES trả về giờ local) */
const fmtRecordTime = (raw?: string): string => {
  if (!raw) return '—';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/* ================================================================
   COMPONENT
================================================================ */
export default function HesReadingManager() {
  const [meters, setMeters]                   = useState<MeterRow[]>([]);
  const [isLoadingMeters, setIsLoadingMeters] = useState(true);
  const [filterArea, setFilterArea]           = useState('');
  const [hesAccount, setHesAccount]           = useState<AccountHes | null>(null);
  const [isGettingToken, setIsGettingToken]   = useState(false);

  const [sections, setSections] = useState<ReadingSection[]>([
    { id: 1, date: yesterdayStr, time: defaultTime, readings: {} }, // Đầu kỳ: hôm qua
    { id: 2, date: todayStr,     time: defaultTime, readings: {} }, // Cuối kỳ: hôm nay
  ]);

  /* ---- Toast ---- */
  const showToast = useCallback((msg: string, type: ToastType = 'info') => {
    notify.show(type, TOAST_TITLE[type], msg);
  }, []);

  /* ---- User areas ---- */
  const userAreas = React.useMemo(() => {
    const raw = pb.authStore.model?.area;
    const items = Array.isArray(raw)
      ? raw
      : typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
    return items.map(item => ID_TO_AREA[item] || item);
  }, [JSON.stringify(pb.authStore.model?.area)]);

  const effectiveAreas = React.useMemo(() => (userAreas.length > 0 ? userAreas : AREAS), [userAreas]);

  /* ---- Load HES account ---- */
  useEffect(() => {
    if (userAreas.length === 0) return;
    const areaFilter = userAreas.map(a => `area='${a.replace(/'/g, "\\'")}'`).join('||');
    pb.collection('AccountHes')
      .getFirstListItem<AccountHes>(`(${areaFilter})`)
      .then(setHesAccount)
      .catch(() => {});
  }, [userAreas]);

  /* ---- Lấy Token HES ---- */
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

  /* ---- Load meters (từ metterinfo.csv, lọc theo KCN) ---- */
  const loadMeters = useCallback(async () => {
    setIsLoadingMeters(true);
    try {
      const rows = await fetchMeterInfo();
      const allowed = new Set(userAreas.length > 0 ? userAreas : AREAS);
      const filtered = rows
        .filter(r => r.STATUS === 'Yes')
        .filter(r => (filterArea ? r.ADDRESS === filterArea : allowed.has(r.ADDRESS)))
        .map((r): MeterRow => ({ id: r.METER_NO, MeterNo: r.METER_NO, HSN: r.METER_NAME, Line: r.LINE_NAME, area: r.ADDRESS }))
        .sort((a, b) => (a.Line + a.MeterNo).localeCompare(b.Line + b.MeterNo));
      setMeters(filtered);
    } catch (err: any) {
      console.error('Error loading meters:', err);
    } finally {
      setIsLoadingMeters(false);
    }
  }, [filterArea, userAreas]);

  useEffect(() => { loadMeters(); }, [loadMeters]);

  /* ================================================================
     DATE / TIME UPDATE
  ================================================================ */
  const updateDate = (id: number, val: string) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, date: val } : s));

  const updateTime = (id: number, val: string) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, time: val } : s));

  /* ================================================================
     FETCH FOR ONE SECTION  (API: GetMeterDataByDate)
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

    for (let i = 0; i < meters.length; i += batchSize) {
      const batch = meters.slice(i, i + batchSize);

      await Promise.all(batch.map(async (meter) => {
        let record: DataMetter | undefined;

        try {
          /* --- Lần 1: cửa sổ +35 phút --- */
          const sStart = toHesDateStr(section.date, section.time);
          const sEnd35 = toHesDateStr(section.date, section.time, 35);
          const url35  = `/hes/api/GetMeterDataByDate?MeterNo=${meter.MeterNo}&StartDate=${sStart}&EndDate=${sEnd35}&Token=${token}`;

          const res1 = await fetch(url35);
          if (res1.ok) {
            const data1 = await res1.json();
            if (!Array.isArray(data1) && (data1 as any)?.MESSAGE === 'invalid token') {
              throw new Error('Token HES hết hạn');
            }
            if (Array.isArray(data1) && data1.length > 0) {
              const valid1 = (data1 as DataMetter[]).filter(r => parseFloat(r.ACTIVE_KW_INDICATE_TOTAL) > 0);
              record = valid1.sort((a, b) =>
                Math.abs(new Date(a.DATE_TIME).getTime() - reqTime) -
                Math.abs(new Date(b.DATE_TIME).getTime() - reqTime)
              )[0];
            }
          }

          /* --- Fallback: cửa sổ +120 phút --- */
          if (!record) {
            const sEnd120 = toHesDateStr(section.date, section.time, 120);
            const url120  = `/hes/api/GetMeterDataByDate?MeterNo=${meter.MeterNo}&StartDate=${sStart}&EndDate=${sEnd120}&Token=${token}`;
            const res2 = await fetch(url120);
            if (res2.ok) {
              const data2 = await res2.json();
              if (Array.isArray(data2) && data2.length > 0) {
                const valid2 = (data2 as DataMetter[]).filter(r => parseFloat(r.ACTIVE_KW_INDICATE_TOTAL) > 0);
                record = valid2.sort((a, b) =>
                  Math.abs(new Date(a.DATE_TIME).getTime() - reqTime) -
                  Math.abs(new Date(b.DATE_TIME).getTime() - reqTime)
                )[0];
              }
            }
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

  /* ================================================================
     CONSUMPTION CALCULATION
  ================================================================ */
  const getConsumption = (meterNo: string, field: 'pg' | 'bt' | 'cd' | 'td' | 'vc', hsn: string): number | null => {
    const r1 = sections[0].readings[meterNo];
    const r2 = sections[1].readings[meterNo];
    if (r1?.status !== 'success' || r2?.status !== 'success') return null;
    const v1 = parseFloat(r1[field]);
    const v2 = parseFloat(r2[field]);
    if (isNaN(v1) || isNaN(v2)) return null;
    const factor = parseFloat(hsn) || 1;
    return Math.round((v2 - v1) * factor);
  };

  const fmt = (val: number | null) =>
    val === null ? '—' : val.toLocaleString('vi-VN', { maximumFractionDigits: 0 });

  /* Công tơ có sản lượng Tổng (kWh) lớn nhất — để đánh dấu trong bảng chi tiết */
  const maxTotalMeterId = React.useMemo(() => {
    let bestId = '';
    let best = -Infinity;
    for (const m of meters) {
      const total = getConsumption(m.MeterNo, 'pg', m.HSN);
      if (total !== null && total > best) { best = total; bestId = m.id; }
    }
    return best > 0 ? bestId : '';
  }, [meters, sections]);

  /* ================================================================
     EXCEL EXPORT
  ================================================================ */
  const exportToExcel = () => {
    const rows = meters.map(m => ({
      'Số công tơ':      m.MeterNo,
      'Trạm':            m.Line || '',
      'Hệ số nhân':      m.HSN  || '',
      'Thời gian đầu kỳ': fmtRecordTime(sections[0].readings[m.MeterNo]?.recordTime),
      'Thời gian cuối kỳ': fmtRecordTime(sections[1].readings[m.MeterNo]?.recordTime),
      'Tổng (kWh)':      getConsumption(m.MeterNo, 'pg', m.HSN) ?? '',
      'Biểu 1 (kWh)':   getConsumption(m.MeterNo, 'bt', m.HSN) ?? '',
      'Biểu 2 (kWh)':   getConsumption(m.MeterNo, 'cd', m.HSN) ?? '',
      'Biểu 3 (kWh)':   getConsumption(m.MeterNo, 'td', m.HSN) ?? '',
      'Vô công (kVarh)': getConsumption(m.MeterNo, 'vc', m.HSN) ?? '',
    }));
    if (rows.length === 0) { showToast('Chưa có dữ liệu để xuất', 'warning'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SanLuong');
    XLSX.writeFile(wb, `SanLuong_HES_${Date.now()}.xlsx`);
  };

  const SECTION_COLOR = ['bg-accent shadow-[var(--accent)]/20', 'bg-purple-600 shadow-purple-600/20'];

  /* ================================================================
     RENDER
  ================================================================ */
  return (
    <div className="space-y-6 pb-6">

      {/* ================================================================
          TOOLBAR: Lấy Token
      ================================================================ */}
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

      {/* ================================================================
          SECTION CARDS (Đầu kỳ & Cuối kỳ)
      ================================================================ */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {sections.map((section, si) => (
          <div key={section.id} className="vl-card overflow-hidden flex flex-col">

            {/* Card header */}
            <div className="p-5 border-b border-[var(--border)] bg-subtle/30">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg shadow-md ${SECTION_COLOR[si]}`}>
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-ink">
                      {section.id === 1 ? 'Lấy chỉ số đầu kỳ' : 'Lấy chỉ số cuối kỳ'}
                    </h3>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-faint">Chỉ số tức thời HES</p>
                  </div>
                </div>
                <button
                  onClick={() => fetchSection(section.id)}
                  disabled={meters.length === 0 || isLoadingMeters}
                  className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Lấy chỉ số
                </button>
              </div>

              {/* Date + Time pickers */}
              <div className="flex gap-3">
                <DatePicker
                  value={section.date}
                  onChange={val => updateDate(section.id, val)}
                  label="Ngày"
                  className="flex-1"
                />
                <TimePicker
                  value={section.time}
                  onChange={val => updateTime(section.id, val)}
                  label="Giờ (24h)"
                  className="flex-1"
                />
              </div>
            </div>

            {/* Reading table */}
            <div className="flex-1 overflow-x-auto" style={{ maxHeight: 440 }}>
              <table className="vl-table w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr>
                    <th>Công tơ</th>
                    <th className="text-center text-faint">Thời gian</th>
                    <th className="text-center text-accent">Tổng</th>
                    <th className="text-center text-accent">Biểu 1</th>
                    <th className="text-center text-orange-500">Biểu 2</th>
                    <th className="text-center text-purple-600">Biểu 3</th>
                    <th className="text-center text-soft">Vô công</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {meters.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-faint text-sm italic">
                        Chưa có danh sách công tơ
                      </td>
                    </tr>
                  ) : (
                    meters.map(m => {
                      const r         = section.readings[m.MeterNo];
                      const isLoading = r?.status === 'loading';
                      const isError   = r?.status === 'error';
                      const isOk      = r?.status === 'success';

                      const cell = (val: string) => isLoading
                        ? <RefreshCw className="w-3 h-3 animate-spin text-faint mx-auto" />
                        : <span className={isError ? 'text-red-400' : isOk ? '' : 'text-faint'}>{val}</span>;

                      return (
                        <tr key={m.id} className="hover:bg-accent-soft transition-colors">
                          <td>
                            <div>
                              <span className="font-mono text-xs font-bold text-accent">{m.MeterNo}</span>
                              {m.Line && <div className="text-[10px] text-faint">{m.Line}</div>}
                            </div>
                          </td>
                          <td className="text-center whitespace-nowrap">
                            {isLoading
                              ? <RefreshCw className="w-3 h-3 animate-spin text-faint mx-auto" />
                              : <span className="text-[11px] font-mono text-faint">{fmtRecordTime(r?.recordTime)}</span>
                            }
                          </td>
                          <td className="text-center text-xs font-bold text-accent">{cell(r?.pg || '-')}</td>
                          <td className="text-center text-xs font-bold text-accent">{cell(r?.bt || '-')}</td>
                          <td className="text-center text-xs font-bold text-orange-500">{cell(r?.cd || '-')}</td>
                          <td className="text-center text-xs font-bold text-purple-600">{cell(r?.td || '-')}</td>
                          <td className="text-center text-xs font-bold text-soft">{cell(r?.vc || '-')}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* ================================================================
          CONSUMPTION TABLE (Cuối kỳ − Đầu kỳ)
      ================================================================ */}
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
              options={[{ value: '', label: 'Tất cả khu vực' }, ...effectiveAreas.map(a => ({ value: a, label: a }))]}
              className="min-w-[170px]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left border-collapse">
            <thead>
              <tr>
                <th>Số công tơ</th>
                <th>Trạm</th>
                <th className="text-center">Hệ số nhân</th>
                <th className="text-center text-faint">Thời gian đầu kỳ</th>
                <th className="text-center text-faint">Thời gian cuối kỳ</th>
                <th className="text-center text-white bg-accent font-extrabold">Tổng (kWh)</th>
                <th className="text-center text-accent">Biểu 1 (kWh)</th>
                <th className="text-center text-orange-500">Biểu 2 (kWh)</th>
                <th className="text-center text-purple-600">Biểu 3 (kWh)</th>
                <th className="text-center text-soft">Vô công (kVarh)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoadingMeters ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center">
                    <RefreshCw className="w-5 h-5 animate-spin text-faint mx-auto" />
                  </td>
                </tr>
              ) : meters.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-faint text-sm italic">
                    Không có dữ liệu công tơ
                  </td>
                </tr>
              ) : (
                meters.map(m => {
                  const isMax = m.id === maxTotalMeterId;
                  return (
                  <tr key={m.id} className={`transition-colors ${isMax ? 'bg-[var(--warning-soft)] hover:bg-amber-100/70' : 'hover:bg-accent-soft'}`}>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        {isMax && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                        <span className="font-mono text-xs font-bold text-accent bg-accent-soft px-2 py-1 rounded">
                          {m.MeterNo}
                        </span>
                      </span>
                    </td>
                    <td className="text-sm text-soft">{m.Line || '—'}</td>
                    <td className="text-center text-xs font-mono text-soft">{m.HSN || '1'}</td>
                    <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">
                      {fmtRecordTime(sections[0].readings[m.MeterNo]?.recordTime)}
                    </td>
                    <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">
                      {fmtRecordTime(sections[1].readings[m.MeterNo]?.recordTime)}
                    </td>
                    <td className={`text-center text-sm font-extrabold text-[var(--accent)] ${isMax ? 'bg-amber-100/60' : 'bg-accent-soft/60'}`}>{fmt(getConsumption(m.MeterNo, 'pg', m.HSN))}</td>
                    <td className="text-center text-xs font-bold text-accent">{fmt(getConsumption(m.MeterNo, 'bt', m.HSN))}</td>
                    <td className="text-center text-xs font-bold text-orange-500">{fmt(getConsumption(m.MeterNo, 'cd', m.HSN))}</td>
                    <td className="text-center text-xs font-bold text-purple-600">{fmt(getConsumption(m.MeterNo, 'td', m.HSN))}</td>
                    <td className="text-center text-xs font-bold text-soft">{fmt(getConsumption(m.MeterNo, 'vc', m.HSN))}</td>
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
