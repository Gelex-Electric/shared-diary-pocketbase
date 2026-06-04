import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, ID_TO_AREA } from '../lib/pocketbase';
import { Meter } from '../types';
import {
  RefreshCw, Download, Zap, X,
  CheckCircle2, XCircle, AlertCircle, Info,
  Table as TableIcon,
} from 'lucide-react';
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
  status: 'idle' | 'loading' | 'success' | 'error';
  errorMsg?: string;
}

interface ReadingSection {
  id: number;
  dateTime: {
    day: string;
    month: string;
    year: string;
    hour: string;
    minute: string;
  };
  readings: Record<string, ReadingData>;
}

const now = new Date();
const defaultDateTime = {
  day:    now.getDate().toString(),
  month:  (now.getMonth() + 1).toString(),
  year:   now.getFullYear().toString(),
  hour:   now.getHours().toString(),
  minute: '0',
};

/* ================================================================
   COMPONENT
================================================================ */
export default function HesReadingManager() {
  const [meters, setMeters] = useState<Meter[]>([]);
  const [isLoadingMeters, setIsLoadingMeters] = useState(true);
  const [filterArea, setFilterArea] = useState('');

  const [sections, setSections] = useState<ReadingSection[]>([
    { id: 1, dateTime: { ...defaultDateTime }, readings: {} },
    { id: 2, dateTime: { ...defaultDateTime }, readings: {} },
  ]);

  /* ---- Toast ---- */
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);
  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 4000);
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

  /* ---- Load meters ---- */
  const loadMeters = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    setIsLoadingMeters(true);
    try {
      const fp: string[] = ['Activate = true'];
      if (filterArea) {
        fp.push(`area = '${filterArea.replace(/'/g, "\\'")}'`);
      } else if (userAreas.length > 0) {
        fp.push(`(${userAreas.map(a => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ')})`);
      }
      const result = await pb.collection('Meter').getFullList<Meter>({
        filter: fp.join(' && '),
        sort: 'Line,MeterNo',
        requestKey: null,
      });
      setMeters(result);
    } catch (err: any) {
      if (!err.isAbort) console.error('Error loading meters:', err);
    } finally {
      setIsLoadingMeters(false);
    }
  }, [filterArea, userAreas]);

  useEffect(() => { loadMeters(); }, [loadMeters]);

  /* ================================================================
     SECTION DATETIME UPDATE
  ================================================================ */
  const updateDateTime = (sectionId: number, field: keyof ReadingSection['dateTime'], value: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, dateTime: { ...s.dateTime, [field]: value } } : s
    ));
  };

  /* ================================================================
     FETCH FOR ONE SECTION
  ================================================================ */
  const fetchSection = async (sectionId: number) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section || meters.length === 0) return;

    // Init all meters to loading
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const init: Record<string, ReadingData> = {};
      meters.forEach(m => {
        init[m.MeterNo] = { meterNo: m.MeterNo, pg: '-', bt: '-', cd: '-', td: '-', vc: '-', status: 'loading' };
      });
      return { ...s, readings: init };
    }));

    const { day, month, year, hour, minute } = section.dateTime;
    const batchSize = 3;

    for (let i = 0; i < meters.length; i += batchSize) {
      const batch = meters.slice(i, i + batchSize);
      await Promise.all(batch.map(async (meter) => {
        let currentMinute = parseInt(minute);
        let currentHour   = parseInt(hour);
        let finalResult: any = null;
        const maxRetries = 29;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          // Normalise overflow
          let h = currentHour + Math.floor(currentMinute / 60);
          let m = currentMinute % 60;
          h = h % 24;

          const url = `/hes-meter/api/GELEXPOWER_getInstant?MA_DDO=ABC&MA_CTO=${meter.MeterNo}&GIO=${h}&PHUT=${m}&NGAY=${day}&THANG=${month}&NAM=${year}`;

          try {
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
              const record = Array.isArray(data) ? data[0] : data;
              if (record?.MESSAGE === 'invalid token') {
                throw new Error('Token HES hết hạn');
              }
              if (parseFloat(record?.BIEU_TONG || '0') > 0) {
                finalResult = record;
                break;
              }
            }
          } catch (fetchErr: any) {
            if (fetchErr.message === 'Token HES hết hạn') throw fetchErr;
            // Network error — continue retry
          }

          currentMinute++;
          await new Promise(r => setTimeout(r, 300));
        }

        setSections(prev => prev.map(s => {
          if (s.id !== sectionId) return s;
          return {
            ...s,
            readings: {
              ...s.readings,
              [meter.MeterNo]: finalResult
                ? {
                    meterNo: meter.MeterNo,
                    pg: finalResult.BIEU_TONG     || '0',
                    bt: finalResult.BIEU_1        || '0',
                    cd: finalResult.BIEU_2        || '0',
                    td: finalResult.BIEU_3        || '0',
                    vc: finalResult.BIEU_TONG_VC  || '0',
                    status: 'success',
                  }
                : { ...s.readings[meter.MeterNo], status: 'error', errorMsg: 'Không tìm thấy dữ liệu' },
            },
          };
        }));
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
    return Math.round((v2 - v1) * factor * 1000) / 1000;
  };

  const fmt = (val: number | null) =>
    val === null ? '—' : val.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  /* ================================================================
     EXCEL EXPORT
  ================================================================ */
  const exportToExcel = () => {
    const rows = meters.map(m => ({
      'Số công tơ':    m.MeterNo,
      'Trạm':          m.Line || '',
      'Hệ số nhân':    m.HSN  || '',
      'Tổng (kWh)':    getConsumption(m.MeterNo, 'pg', m.HSN) ?? '',
      'Biểu 1 (kWh)':  getConsumption(m.MeterNo, 'bt', m.HSN) ?? '',
      'Biểu 2 (kWh)':  getConsumption(m.MeterNo, 'cd', m.HSN) ?? '',
      'Biểu 3 (kWh)':  getConsumption(m.MeterNo, 'td', m.HSN) ?? '',
      'Vô công (kVarh)': getConsumption(m.MeterNo, 'vc', m.HSN) ?? '',
    }));
    if (rows.length === 0) { showToast('Chưa có dữ liệu để xuất', 'warning'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SanLuong');
    XLSX.writeFile(wb, `SanLuong_HES_${Date.now()}.xlsx`);
  };

  /* ================================================================
     TOAST CONFIG
  ================================================================ */
  const toastCfg = {
    success: { icon: CheckCircle2, cls: 'vl-alert vl-alert-success' },
    error:   { icon: XCircle,      cls: 'vl-alert vl-alert-danger'  },
    warning: { icon: AlertCircle,  cls: 'vl-alert vl-alert-warning' },
    info:    { icon: Info,         cls: 'vl-alert vl-alert-primary' },
  };

  const SECTION_COLOR = ['bg-[#5a8dee] shadow-[#5a8dee]/20', 'bg-purple-600 shadow-purple-600/20'];

  /* ================================================================
     RENDER
  ================================================================ */
  return (
    <div className="space-y-6 pb-6">

      {/* ---- Toast ---- */}
      <AnimatePresence>
        {toast && (() => {
          const c = toastCfg[toast.type]; const Icon = c.icon;
          return (
            <motion.div key="toast"
              initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className={`fixed top-4 right-4 z-[120] max-w-sm flex items-center gap-3 px-4 py-3 rounded shadow-xl text-white text-sm font-medium ${c.cls}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{toast.message}</span>
              <button onClick={() => setToast(null)} className="hover:opacity-60"><X className="w-3.5 h-3.5" /></button>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ================================================================
          SECTION CARDS (Đợt 1 & Đợt 2)
      ================================================================ */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {sections.map((section, si) => (
          <div key={section.id} className="vl-card overflow-hidden flex flex-col">
            {/* Card header */}
            <div className="p-5 border-b border-slate-100 bg-slate-50/30">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg shadow-md ${SECTION_COLOR[si]}`}>
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Lấy chỉ số đợt {section.id}</h3>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Chỉ số tức thời HES</p>
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

              {/* DateTime inputs */}
              <div className="grid grid-cols-5 gap-2">
                {(['day','month','year','hour','minute'] as const).map(field => (
                  <div key={field} className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-0.5">
                      {field === 'day' ? 'Ngày' : field === 'month' ? 'Tháng' : field === 'year' ? 'Năm' : field === 'hour' ? 'Giờ' : 'Phút'}
                    </label>
                    <input
                      type="number"
                      value={section.dateTime[field]}
                      onChange={e => updateDateTime(section.id, field, e.target.value)}
                      className="w-full px-2 py-2 bg-white border border-slate-200 rounded text-sm font-bold text-center outline-none focus:ring-2 focus:ring-[#5a8dee]"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Reading table */}
            <div className="flex-1 overflow-x-auto" style={{ maxHeight: 440 }}>
              <table className="vl-table w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr>
                    <th>Công tơ</th>
                    <th className="text-center text-[#5a8dee]">Tổng</th>
                    <th className="text-center text-[#5a8dee]">Biểu 1</th>
                    <th className="text-center text-orange-500">Biểu 2</th>
                    <th className="text-center text-purple-600">Biểu 3</th>
                    <th className="text-center text-slate-500">Vô công</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {meters.length === 0 ? (
                    <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-sm italic">Chưa có danh sách công tơ</td></tr>
                  ) : (
                    meters.map(m => {
                      const r = section.readings[m.MeterNo];
                      const isLoading = r?.status === 'loading';
                      const isError   = r?.status === 'error';
                      const isOk      = r?.status === 'success';

                      const cell = (val: string) => isLoading
                        ? <RefreshCw className="w-3 h-3 animate-spin text-slate-300 mx-auto" />
                        : <span className={isError ? 'text-red-400' : isOk ? '' : 'text-slate-300'}>{val}</span>;

                      return (
                        <tr key={m.id} className="hover:bg-[#f4f8ff] transition-colors">
                          <td>
                            <div>
                              <span className="font-mono text-xs font-bold text-[#5a8dee]">{m.MeterNo}</span>
                              {m.Line && <div className="text-[10px] text-slate-400">{m.Line}</div>}
                            </div>
                          </td>
                          <td className="text-center text-xs font-bold text-[#5a8dee]">{cell(r?.pg || '-')}</td>
                          <td className="text-center text-xs font-bold text-[#5a8dee]">{cell(r?.bt || '-')}</td>
                          <td className="text-center text-xs font-bold text-orange-500">{cell(r?.cd || '-')}</td>
                          <td className="text-center text-xs font-bold text-purple-600">{cell(r?.td || '-')}</td>
                          <td className="text-center text-xs font-bold text-slate-500">{cell(r?.vc || '-')}</td>
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
          CONSUMPTION TABLE (Đợt 2 − Đợt 1)
      ================================================================ */}
      <div className="vl-card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#5a8dee] rounded-lg shadow-md shadow-[#5a8dee]/20">
              <TableIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Chi tiết sản lượng</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Tiêu thụ = (Đợt 2 − Đợt 1) × Hệ số nhân</p>
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
            <select
              value={filterArea}
              onChange={e => setFilterArea(e.target.value)}
              className="bg-white border border-slate-200 rounded px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-[#5a8dee] outline-none"
            >
              <option value="">Tất cả khu vực</option>
              {effectiveAreas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left border-collapse">
            <thead>
              <tr>
                <th>Số công tơ</th>
                <th>Trạm</th>
                <th className="text-center">Hệ số nhân</th>
                <th className="text-center text-[#5a8dee]">Tổng (kWh)</th>
                <th className="text-center text-[#5a8dee]">Biểu 1 (kWh)</th>
                <th className="text-center text-orange-500">Biểu 2 (kWh)</th>
                <th className="text-center text-purple-600">Biểu 3 (kWh)</th>
                <th className="text-center text-slate-500">Vô công (kVarh)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoadingMeters ? (
                <tr><td colSpan={8} className="py-10 text-center"><RefreshCw className="w-5 h-5 animate-spin text-slate-300 mx-auto" /></td></tr>
              ) : meters.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-slate-400 text-sm italic">Không có dữ liệu công tơ</td></tr>
              ) : (
                meters.map(m => (
                  <tr key={m.id} className="hover:bg-[#f4f8ff] transition-colors">
                    <td>
                      <span className="font-mono text-xs font-bold text-[#5a8dee] bg-[#e8f3ff] px-2 py-1 rounded">{m.MeterNo}</span>
                    </td>
                    <td className="text-sm text-slate-500">{m.Line || '—'}</td>
                    <td className="text-center text-xs font-mono text-slate-500">{m.HSN || '1'}</td>
                    <td className="text-center text-xs font-bold text-[#5a8dee]">{fmt(getConsumption(m.MeterNo, 'pg', m.HSN))}</td>
                    <td className="text-center text-xs font-bold text-[#5a8dee]">{fmt(getConsumption(m.MeterNo, 'bt', m.HSN))}</td>
                    <td className="text-center text-xs font-bold text-orange-500">{fmt(getConsumption(m.MeterNo, 'cd', m.HSN))}</td>
                    <td className="text-center text-xs font-bold text-purple-600">{fmt(getConsumption(m.MeterNo, 'td', m.HSN))}</td>
                    <td className="text-center text-xs font-bold text-slate-500">{fmt(getConsumption(m.MeterNo, 'vc', m.HSN))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
