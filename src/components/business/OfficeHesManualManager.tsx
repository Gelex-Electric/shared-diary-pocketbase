import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS } from '../../lib/pocketbase';
import { kcnColorOf } from '../../lib/kcnColors';
import { fetchMeterInfo } from '../../lib/meterInfo';
import { AccountHes, DataMetter } from '../../types';
import { RefreshCw, Download, Zap, Table as TableIcon, CreditCard } from 'lucide-react';
import { DatePicker, TimePicker } from '../ui/DateTimePickers';
import { toast as notify, type ToastType } from '../../lib/toast';
import * as XLSX from 'xlsx';

interface MeterRow { id: string; MeterNo: string; HSN: string; Line: string; area: string; }

const TOAST_TITLE: Record<ToastType, string> = {
  success: 'Thành công', error: 'Lỗi', warning: 'Lưu ý', info: 'Thông báo', alert: 'Thông báo',
};

interface ReadingData {
  meterNo: string;
  pg: string; bt: string; cd: string; td: string; vc: string;
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

const _now       = new Date();
const _yesterday = new Date(_now);
_yesterday.setDate(_yesterday.getDate() - 1);
const _pad = (n: number) => String(n).padStart(2, '0');
const todayStr     = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
const yesterdayStr = `${_yesterday.getFullYear()}-${_pad(_yesterday.getMonth() + 1)}-${_pad(_yesterday.getDate())}`;
const defaultTime  = '00:00';

const pad2 = (n: number) => String(n).padStart(2, '0');

function toHesDateStr(date: string, time: string, offsetMinutes = 0): string {
  const d = new Date(`${date}T${time}:00`);
  d.setMinutes(d.getMinutes() + offsetMinutes);
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}00`
  );
}

const fmtRecordTime = (raw?: string): string => {
  if (!raw) return '—';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/* ================================================================
   HES "Lấy thủ công" — bản khối Văn phòng.
   Dùng 1 tài khoản HES của khối Văn phòng (1 token chung cho mọi KCN).
   Hai bảng lấy chỉ số nhóm hàng theo KCN; bảng chi tiết sản lượng tách
   thành N bảng theo KCN.
================================================================ */
export default function OfficeHesManualManager() {
  const [meters, setMeters]                   = useState<MeterRow[]>([]);
  const [isLoadingMeters, setIsLoadingMeters] = useState(true);
  const [hesAccount, setHesAccount]           = useState<AccountHes | null>(null);
  const [isGettingToken, setIsGettingToken]   = useState(false);

  const [sections, setSections] = useState<ReadingSection[]>([
    { id: 1, date: yesterdayStr, time: defaultTime, readings: {} },
    { id: 2, date: todayStr,     time: defaultTime, readings: {} },
  ]);

  const showToast = useCallback((msg: string, type: ToastType = 'info') => {
    notify.show(type, TOAST_TITLE[type], msg);
  }, []);

  /* ---- Tài khoản HES khối Văn phòng: 1 bản ghi đầu, token dùng chung ---- */
  useEffect(() => {
    pb.collection('AccountHes').getList<AccountHes>(1, 1)
      .then(res => setHesAccount(res.items[0] || null))
      .catch(() => {});
  }, []);

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

  /* ---- Nạp toàn bộ công tơ đang hoạt động (mọi KCN) ---- */
  const loadMeters = useCallback(async () => {
    setIsLoadingMeters(true);
    try {
      const rows = await fetchMeterInfo();
      const filtered = rows
        .filter(r => r.STATUS === 'Yes')
        .map((r): MeterRow => ({ id: r.METER_NO, MeterNo: r.METER_NO, HSN: r.METER_NAME, Line: r.LINE_NAME, area: r.ADDRESS }))
        .sort((a, b) => (a.Line + a.MeterNo).localeCompare(b.Line + b.MeterNo));
      setMeters(filtered);
    } catch (err: any) {
      console.error('Error loading meters:', err);
    } finally {
      setIsLoadingMeters(false);
    }
  }, []);

  useEffect(() => { loadMeters(); }, [loadMeters]);

  /** Công tơ nhóm theo KCN, giữ thứ tự AREAS. */
  const metersByZone = React.useMemo(() => {
    const map = new Map<string, MeterRow[]>();
    for (const m of meters) {
      const z = m.area || '—';
      if (!map.has(z)) map.set(z, []);
      map.get(z)!.push(m);
    }
    return AREAS.filter(a => map.has(a)).map(a => ({ area: a, rows: map.get(a)! }));
  }, [meters]);

  const updateDate = (id: number, val: string) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, date: val } : s));
  const updateTime = (id: number, val: string) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, time: val } : s));

  /* ---- Fetch 1 section (giữ nguyên logic bản gốc) ---- */
  const fetchSection = async (sectionId: number) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section || meters.length === 0) return;
    if (!section.date || !section.time) {
      showToast('Vui lòng chọn ngày và giờ lấy chỉ số', 'warning');
      return;
    }

    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const init: Record<string, ReadingData> = {};
      meters.forEach(m => {
        init[m.MeterNo] = { meterNo: m.MeterNo, pg: '-', bt: '-', cd: '-', td: '-', vc: '-', status: 'loading' };
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
                Math.abs(new Date(b.DATE_TIME).getTime() - reqTime))[0];
            }
          }
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
                  Math.abs(new Date(b.DATE_TIME).getTime() - reqTime))[0];
              }
            }
          }
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
                  : { ...s.readings[meter.MeterNo], status: 'error', errorMsg: 'Không tìm thấy dữ liệu' },
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
                [meter.MeterNo]: { ...s.readings[meter.MeterNo], status: 'error', errorMsg: 'Lỗi kết nối' },
              },
            };
          }));
        }
      }));
      await new Promise(r => setTimeout(r, 500));
    }
  };

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

  const exportToExcel = () => {
    if (meters.length === 0) { showToast('Chưa có dữ liệu để xuất', 'warning'); return; }
    const wb = XLSX.utils.book_new();
    for (const { area, rows } of metersByZone) {
      const data = rows.map(m => ({
        'Số công tơ':        m.MeterNo,
        'Trạm':              m.Line || '',
        'Hệ số nhân':        m.HSN  || '',
        'Thời gian đầu kỳ':  fmtRecordTime(sections[0].readings[m.MeterNo]?.recordTime),
        'Thời gian cuối kỳ': fmtRecordTime(sections[1].readings[m.MeterNo]?.recordTime),
        'Tổng (kWh)':        getConsumption(m.MeterNo, 'pg', m.HSN) ?? '',
        'Biểu 1 (kWh)':      getConsumption(m.MeterNo, 'bt', m.HSN) ?? '',
        'Biểu 2 (kWh)':      getConsumption(m.MeterNo, 'cd', m.HSN) ?? '',
        'Biểu 3 (kWh)':      getConsumption(m.MeterNo, 'td', m.HSN) ?? '',
        'Vô công (kVarh)':   getConsumption(m.MeterNo, 'vc', m.HSN) ?? '',
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const sheetName = area.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName || 'KCN');
    }
    XLSX.writeFile(wb, `SanLuong_HES_${Date.now()}.xlsx`);
  };

  const SECTION_COLOR = ['bg-accent shadow-[var(--accent)]/20', 'bg-purple-600 shadow-purple-600/20'];

  return (
    <div className="space-y-6 pb-6">
      {/* Toolbar Token */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-2 text-sm text-soft">
          <Zap className="w-4 h-4 text-accent" />
          <span>Token HES (khối Văn phòng):</span>
          <span className={`font-mono text-xs px-2 py-0.5 rounded ${hesAccount?.Token ? 'bg-[var(--success-soft)] text-ok' : 'bg-[var(--danger-soft)] text-red-500'}`}>
            {hesAccount?.Token ? hesAccount.Token.slice(0, 20) + '…' : 'Chưa có token'}
          </span>
        </div>
        <button onClick={getToken} disabled={isGettingToken || !hesAccount} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
          {isGettingToken ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
          {isGettingToken ? 'Đang lấy...' : 'Lấy Token'}
        </button>
      </div>

      {/* 2 bảng lấy chỉ số (đầu kỳ / cuối kỳ), hàng nhóm theo KCN */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {sections.map((section, si) => (
          <div key={section.id} className="vl-card overflow-hidden flex flex-col">
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
                <button onClick={() => fetchSection(section.id)} disabled={meters.length === 0 || isLoadingMeters} className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
                  <RefreshCw className="w-3.5 h-3.5" /> Lấy chỉ số
                </button>
              </div>
              <div className="flex gap-3">
                <DatePicker value={section.date} onChange={val => updateDate(section.id, val)} label="Ngày" className="flex-1" />
                <TimePicker value={section.time} onChange={val => updateTime(section.id, val)} label="Giờ (24h)" className="flex-1" />
              </div>
            </div>

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
                    <tr><td colSpan={7} className="py-10 text-center text-faint text-sm italic">Chưa có danh sách công tơ</td></tr>
                  ) : (
                    metersByZone.map(({ area, rows }) => {
                      const c = kcnColorOf(area);
                      return (
                        <React.Fragment key={area}>
                          <tr className={c.bg}>
                            <td colSpan={7} className={`py-1.5 text-[11px] font-bold ${c.text}`}>
                              <span className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${c.dot}`} />
                              {area} · {rows.length} công tơ
                            </td>
                          </tr>
                          {rows.map(m => {
                            const r = section.readings[m.MeterNo];
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
                                    : <span className="text-[11px] font-mono text-faint">{fmtRecordTime(r?.recordTime)}</span>}
                                </td>
                                <td className="text-center text-xs font-bold text-accent">{cell(r?.pg || '-')}</td>
                                <td className="text-center text-xs font-bold text-accent">{cell(r?.bt || '-')}</td>
                                <td className="text-center text-xs font-bold text-orange-500">{cell(r?.cd || '-')}</td>
                                <td className="text-center text-xs font-bold text-purple-600">{cell(r?.td || '-')}</td>
                                <td className="text-center text-xs font-bold text-soft">{cell(r?.vc || '-')}</td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Chi tiết sản lượng — tách theo KCN */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-accent rounded-lg shadow-md shadow-[var(--accent)]/20">
            <TableIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-ink">Chi tiết sản lượng theo KCN</h3>
            <p className="text-[10px] text-faint mt-0.5">Tiêu thụ = (Cuối kỳ − Đầu kỳ) × Hệ số nhân</p>
          </div>
        </div>
        <button onClick={exportToExcel} disabled={meters.length === 0} className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /> Xuất Excel
        </button>
      </div>

      {isLoadingMeters ? (
        <div className="vl-card flex items-center justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-faint" /></div>
      ) : metersByZone.length === 0 ? (
        <div className="vl-card flex items-center justify-center py-16 text-faint text-sm italic">Không có dữ liệu công tơ</div>
      ) : (
        metersByZone.map(({ area, rows }) => {
          const c = kcnColorOf(area);
          return (
            <div key={area} className="vl-card overflow-hidden">
              <div className={`px-5 py-3 border-b border-[var(--border)] flex items-center gap-2.5 ${c.bg}`}>
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
                    {rows.map(m => (
                      <tr key={m.id} className="hover:bg-subtle transition-colors">
                        <td><span className="font-mono text-xs font-bold text-accent bg-accent-soft px-2 py-1 rounded">{m.MeterNo}</span></td>
                        <td className="text-sm text-soft">{m.Line || '—'}</td>
                        <td className="text-center text-xs font-mono text-soft">{m.HSN || '1'}</td>
                        <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">{fmtRecordTime(sections[0].readings[m.MeterNo]?.recordTime)}</td>
                        <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">{fmtRecordTime(sections[1].readings[m.MeterNo]?.recordTime)}</td>
                        <td className="text-center text-sm font-extrabold text-ink border-x border-[var(--border)]">{fmt(getConsumption(m.MeterNo, 'pg', m.HSN))}</td>
                        <td className="text-center text-xs font-bold text-accent">{fmt(getConsumption(m.MeterNo, 'bt', m.HSN))}</td>
                        <td className="text-center text-xs font-bold text-orange-500">{fmt(getConsumption(m.MeterNo, 'cd', m.HSN))}</td>
                        <td className="text-center text-xs font-bold text-purple-500">{fmt(getConsumption(m.MeterNo, 'td', m.HSN))}</td>
                        <td className="text-center text-xs font-bold text-soft">{fmt(getConsumption(m.MeterNo, 'vc', m.HSN))}</td>
                      </tr>
                    ))}
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
