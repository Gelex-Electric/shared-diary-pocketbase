import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Bar,
  Line,
  ReferenceLine,
} from 'recharts';
import {
  Activity,
  Building2,
  HelpCircle,
  Gauge,
  Info,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { pb } from '../lib/pocketbase';
import { Meter } from '../types';
import { DatePicker } from './ui/DateTimePickers';
import { Select } from './ui/Select';

/* ================================================================
   CACHE CSV (module-level) — datametter.csv chỉ tải 1 lần/phiên.
================================================================ */
let _meterCsvCache: string | null = null;
let _meterCsvPromise: Promise<string> | null = null;

function loadMeterCsv(): Promise<string> {
  if (_meterCsvCache !== null) return Promise.resolve(_meterCsvCache);
  if (_meterCsvPromise) return _meterCsvPromise;

  _meterCsvPromise = fetch('/datametter.csv')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then(text => {
      _meterCsvCache = text.replace(/^﻿/, ''); // bỏ BOM nếu có
      return _meterCsvCache;
    })
    .catch(err => {
      _meterCsvPromise = null;
      throw err;
    });

  return _meterCsvPromise;
}

/* ================================================================
   HELPERS
================================================================ */
const p2 = (n: number) => String(n).padStart(2, '0');

const fmtDateKey = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

const fmtDateVN = (key: string) => {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};

const timeLabel = (dt: Date) => `${p2(dt.getHours())}:${p2(dt.getMinutes())}`;

/** Định dạng số CHÍNH XÁC theo dữ liệu (không ép làm tròn), kiểu vi-VN. */
const fmtVal = (v: number) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(v);

/* ================================================================
   TYPES nội bộ
================================================================ */
/** Một bản ghi đo tại ĐÚNG thời điểm trong CSV (không làm tròn). */
interface Reading {
  t: number;       // số phút trong ngày (để sắp xếp / trục X)
  label: string;   // 'HH:mm'
  ua: number;
  ub: number;
  uc: number;
  kw: number;
}

// meterNo -> dateKey -> danh sách bản ghi (sắp theo thời gian)
type ReadingIndex = Map<string, Map<string, Reading[]>>;

interface CustomerInfo {
  id: string;
  mkh: string;
  name: string;
  meters: { meterNo: string; line: string }[];
}

/** Chuỗi dữ liệu 1 TRẠM (điểm đo) trong ngày. */
interface StationSeries {
  meterNo: string;
  line: string;        // tên trạm (vd: YM.KIMTIN.3000KVA.ECHO)
  data: any[];         // [{ slot, label, ua, ub, uc, p }]
  peakP: number;       // P (kW) lớn nhất trong ngày của trạm này
  peakLabel: string;   // mốc thời gian đạt P max
}

interface CustomerChart {
  id: string;
  mkh: string;
  name: string;
  peakP: number;             // = P max lớn nhất trong các trạm — dùng xếp hạng
  stations: StationSeries[]; // chỉ trạm có điện áp > 0, sắp theo peakP giảm dần
}

/* ================================================================
   MÀU SẮC — đồng bộ palette SummaryDashboard.
   Mỗi biểu đồ chỉ vẽ 1 trạm: 3 đường điện áp + 1 cột công suất.
================================================================ */
const PHASE_COLOR = { ua: '#3b82f6', ub: '#10b981', uc: '#f59e0b' }; // Ua xanh dương, Ub xanh lá, Uc hổ phách
const P_FILL = '#a5b4fc';                                            // cột P (kW)

/** Nhãn trạm để hiển thị (vd: YM.KIMTIN.3000KVA.ECHO). */
const stationLabel = (s: { line: string; meterNo: string }) => s.line || s.meterNo;

/* ================================================================
   TOOLTIP tuỳ biến — nền sáng (1 trạm: Ua/Ub/Uc + P).
================================================================ */
const SERIES_LABEL: Record<string, string> = { ua: 'Ua', ub: 'Ub', uc: 'Uc', p: 'P' };

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((p: any) => p.value != null);
  if (rows.length === 0) return null;

  return (
    <div className="vl-chart-tooltip">
      <div className="vl-chart-tooltip-title">Thời điểm {label}</div>
      <div className="vl-chart-tooltip-group">
        {rows
          .slice()
          .sort((a: any, b: any) => (a.dataKey === 'p' ? 1 : 0) - (b.dataKey === 'p' ? 1 : 0))
          .map((it: any, i: number) => {
            const isP = it.dataKey === 'p';
            return (
              <div key={i} className="vl-chart-tooltip-row">
                <span className="vl-dot" style={{ background: it.color }} />
                <span className="vl-lbl">{SERIES_LABEL[it.dataKey] ?? it.dataKey}</span>
                <span className="vl-val">
                  {fmtVal(Number(it.value))} {isP ? 'kW' : 'V'}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* ================================================================
   LEGEND tuỳ biến — 3 đường điện áp + 1 cột công suất.
================================================================ */
function LineSwatch({ color }: { color: string }) {
  return (
    <svg width="20" height="6" className="shrink-0">
      <line x1="0" y1="3" x2="20" y2="3" stroke={color} strokeWidth="2.4" />
    </svg>
  );
}

function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-3 border-t border-slate-100 text-[10px] font-semibold text-slate-500">
      <span className="inline-flex items-center gap-1"><LineSwatch color={PHASE_COLOR.ua} /> Ua</span>
      <span className="inline-flex items-center gap-1"><LineSwatch color={PHASE_COLOR.ub} /> Ub</span>
      <span className="inline-flex items-center gap-1"><LineSwatch color={PHASE_COLOR.uc} /> Uc</span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded-sm" style={{ background: P_FILL }} /> P (kW)
      </span>
    </div>
  );
}

/* ================================================================
   COMPONENT
================================================================ */
export default function VoltagePowerDashboard() {
  /* ---- CSV ---- */
  const [csvContent, setCsvContent] = useState<string>(_meterCsvCache ?? '');
  const [csvError, setCsvError] = useState<string>('');

  useEffect(() => {
    if (_meterCsvCache !== null) return;
    let mounted = true;
    loadMeterCsv()
      .then(text => { if (mounted) setCsvContent(text); })
      .catch(err => {
        console.error('Không tải được datametter.csv:', err);
        if (mounted) setCsvError('Không tải được dữ liệu đo xa (datametter.csv).');
      });
    return () => { mounted = false; };
  }, []);

  /* ---- Meters từ PocketBase (map công tơ → khách hàng) ---- */
  const [meters, setMeters] = useState<Meter[]>([]);
  const [isLoadingMeters, setIsLoadingMeters] = useState(true);

  const userAreas = useMemo(() => {
    const raw = pb.authStore.model?.area;
    return Array.isArray(raw)
      ? raw
      : typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  }, [JSON.stringify(pb.authStore.model?.area)]);

  useEffect(() => {
    let mounted = true;
    if (!pb.authStore.isValid) { setIsLoadingMeters(false); return; }
    setIsLoadingMeters(true);
    const fp: string[] = [];
    if (userAreas.length > 0) {
      fp.push(`(${userAreas.map(a => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ')})`);
    }
    pb.collection('Meter')
      .getFullList<Meter>({
        filter: fp.join(' && '),
        sort: 'Customer.MKH,MeterNo',
        expand: 'Customer',
        requestKey: null,
      })
      .then(res => { if (mounted) setMeters(res); })
      .catch(err => { if (!err?.isAbort) console.error('Lỗi tải công tơ:', err); })
      .finally(() => { if (mounted) setIsLoadingMeters(false); });
    return () => { mounted = false; };
  }, [userAreas]);

  // customerId -> CustomerInfo (gồm danh sách công tơ của khách)
  const customerInfoMap = useMemo(() => {
    const map = new Map<string, CustomerInfo>();
    for (const mt of meters) {
      const cust = mt.expand?.Customer;
      const cid = mt.Customer;
      if (!cid) continue;
      if (!map.has(cid)) {
        map.set(cid, {
          id: cid,
          mkh: cust?.MKH || '?',
          name: cust?.Name || 'Không rõ',
          meters: [],
        });
      }
      map.get(cid)!.meters.push({ meterNo: mt.MeterNo, line: mt.Line || '' });
    }
    return map;
  }, [meters]);

  /* ---- Phân tích CSV → chỉ mục theo công tơ / ngày (giữ nguyên thời điểm) ---- */
  const { readingIndex, dateKeys } = useMemo(() => {
    const index: ReadingIndex = new Map();
    const dateSet = new Set<string>();

    if (csvContent) {
      const lines = csvContent.split(/\r?\n/);
      // Header: METER_NO,DATE_TIME,PHASE_A_VOLTS,PHASE_B_VOLTS,PHASE_C_VOLTS,TOTAL_KW
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',');
        if (cols.length < 6) continue;

        const meterNo = cols[0].trim();
        const dtRaw = cols[1].trim();
        if (!meterNo || !dtRaw) continue;

        const dt = new Date(dtRaw.replace(' ', 'T'));
        if (isNaN(dt.getTime())) continue;

        const dateKey = fmtDateKey(dt);
        const reading: Reading = {
          t: dt.getHours() * 60 + dt.getMinutes(),
          label: timeLabel(dt),
          ua: parseFloat(cols[2]) || 0,
          ub: parseFloat(cols[3]) || 0,
          uc: parseFloat(cols[4]) || 0,
          kw: parseFloat(cols[5]) || 0,
        };

        let byDate = index.get(meterNo);
        if (!byDate) { byDate = new Map(); index.set(meterNo, byDate); }
        let list = byDate.get(dateKey);
        if (!list) { list = []; byDate.set(dateKey, list); }
        list.push(reading);
        dateSet.add(dateKey);
      }
    }

    return { readingIndex: index, dateKeys: Array.from(dateSet).sort() };
  }, [csvContent]);

  /* ---- Ngày mặc định = HÔM QUA (fallback ngày gần nhất có dữ liệu) ---- */
  const defaultDate = useMemo(() => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const key = fmtDateKey(y);
    if (dateKeys.includes(key)) return key;
    const earlier = dateKeys.filter(k => k <= key);
    if (earlier.length) return earlier[earlier.length - 1];
    return dateKeys[dateKeys.length - 1] || '';
  }, [dateKeys]);

  /* ---- Ngày đang chọn ---- */
  const [selectedDate, setSelectedDate] = useState<string>('');
  useEffect(() => {
    if (defaultDate && !selectedDate) setSelectedDate(defaultDate);
  }, [defaultDate, selectedDate]);

  /* ---- Dựng dữ liệu biểu đồ cho từng khách hàng theo ngày chọn ----
     Mỗi TRẠM (công tơ) là một chuỗi riêng; khách nhiều điểm đo → nhiều trạm
     để chọn qua dropdown (mỗi biểu đồ chỉ vẽ 1 trạm). */
  const chartableCustomers = useMemo<CustomerChart[]>(() => {
    if (!selectedDate) return [];
    const result: CustomerChart[] = [];

    for (const info of customerInfoMap.values()) {
      const stations: StationSeries[] = [];

      for (const m of info.meters) {
        const list = readingIndex.get(m.meterNo)?.get(selectedDate);
        if (!list || list.length === 0) continue;

        // Trạm chỉ vẽ khi có điện áp 3 pha > 0 (ít nhất 1 bản ghi)
        let hasVoltage = false;
        for (const r of list) {
          if (r.ua > 0 && r.ub > 0 && r.uc > 0) { hasVoltage = true; break; }
        }
        if (!hasVoltage) continue;

        // Sắp theo thời gian thực — KHÔNG làm tròn, giữ nguyên mốc & giá trị
        const sorted = [...list].sort((a, b) => a.t - b.t);
        let peakP = 0;
        let peakLabel = '';
        const data = sorted.map(r => {
          if (r.kw > peakP) { peakP = r.kw; peakLabel = r.label; }
          return {
            t: r.t,
            label: r.label,
            ua: r.ua > 0 ? r.ua : null,
            ub: r.ub > 0 ? r.ub : null,
            uc: r.uc > 0 ? r.uc : null,
            p: r.kw,
          };
        });

        stations.push({ meterNo: m.meterNo, line: m.line, data, peakP, peakLabel });
      }

      if (stations.length === 0) continue;

      // Trạm có P max lớn nhất đứng đầu (mặc định chọn)
      stations.sort((a, b) => b.peakP - a.peakP);
      result.push({
        id: info.id,
        mkh: info.mkh,
        name: info.name,
        peakP: stations[0].peakP,
        stations,
      });
    }

    // Xếp hạng khách theo P MAX giảm dần
    result.sort((a, b) => b.peakP - a.peakP);
    return result;
  }, [selectedDate, customerInfoMap, readingIndex]);

  const chartById = useMemo(() => {
    const m = new Map<string, CustomerChart>();
    chartableCustomers.forEach(c => m.set(c.id, c));
    return m;
  }, [chartableCustomers]);

  /* ---- Mặc định: 3 biểu đồ trái = P max cao nhất, 3 phải = P max thấp nhất ---- */
  const defaultPicks = useMemo<string[]>(() => {
    const ids = chartableCustomers.map(c => c.id);
    const picks: string[] = [];
    const used = new Set<string>();
    const push = (id?: string) => { if (id && !used.has(id)) { used.add(id); picks.push(id); } };
    push(ids[0]);
    push(ids[1]);
    push(ids[2]);
    push(ids[ids.length - 1]);
    push(ids[ids.length - 2]);
    push(ids[ids.length - 3]);
    for (const id of ids) { if (picks.length >= 6) break; push(id); }
    while (picks.length < 6) picks.push('');
    return picks.slice(0, 6);
  }, [chartableCustomers]);

  /* ---- 6 ô chọn khách hàng + trạm (sticky, reset khi đổi ngày/khu vực) ---- */
  const [slots, setSlots] = useState<string[]>(['', '', '', '', '', '']);
  const [stationSlots, setStationSlots] = useState<string[]>(['', '', '', '', '', '']);
  const [stickyKey, setStickyKey] = useState<string>('');

  useEffect(() => {
    const key = `${selectedDate}_${userAreas.join('|')}_${chartableCustomers.length}`;
    if (key !== stickyKey) {
      setStickyKey(key);
      setSlots(defaultPicks);
      setStationSlots(['', '', '', '', '', '']);
    }
  }, [selectedDate, userAreas, chartableCustomers.length, defaultPicks, stickyKey]);

  const setSlot = (i: number, id: string) => {
    setSlots(prev => prev.map((v, idx) => (idx === i ? id : v)));
    setStationSlots(prev => prev.map((v, idx) => (idx === i ? '' : v))); // đổi khách → reset trạm về mặc định
  };
  const setStation = (i: number, meterNo: string) =>
    setStationSlots(prev => prev.map((v, idx) => (idx === i ? meterNo : v)));

  const SLOT_META = [
    { title: 'P max cao nhất', Icon: TrendingUp, tone: 'text-rose-600' },
    { title: 'P max cao thứ 2', Icon: TrendingUp, tone: 'text-rose-500' },
    { title: 'P max cao thứ 3', Icon: TrendingUp, tone: 'text-rose-400' },
    { title: 'P max thấp nhất', Icon: TrendingDown, tone: 'text-emerald-600' },
    { title: 'P max thấp thứ 2', Icon: TrendingDown, tone: 'text-emerald-500' },
    { title: 'P max thấp thứ 3', Icon: TrendingDown, tone: 'text-emerald-400' },
  ];

  const isReady = !!csvContent && !isLoadingMeters;
  const noData = isReady && chartableCustomers.length === 0;

  /* ---- Render 1 thẻ biểu đồ (1 trạm: 3 đường điện áp + 1 cột P) ---- */
  const renderCard = (i: number) => {
    const meta = SLOT_META[i];
    const selId = slots[i];
    const cust = selId ? chartById.get(selId) : undefined;
    const stations = cust?.stations ?? [];
    const effMeter = (stationSlots[i] && stations.some(s => s.meterNo === stationSlots[i]))
      ? stationSlots[i]
      : (stations[0]?.meterNo ?? '');
    const station = stations.find(s => s.meterNo === effMeter);
    const multiStation = stations.length > 1;

    return (
      <div key={i} className="vl-card p-5 flex flex-col min-h-[440px]">
        {/* Tiêu đề + bộ chọn */}
        <div className="flex flex-col gap-2.5 mb-4">
          <div className="flex items-center gap-2">
            <meta.Icon className={`w-4 h-4 ${meta.tone}`} />
            <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase font-mono">
              Biểu đồ {i + 1} · {meta.title}
            </span>
          </div>

          {/* Chọn khách hàng */}
          <div className={`border rounded p-2.5 flex items-center gap-2.5 transition-colors ${
            cust ? 'bg-[#f4f8ff] border-[#5a8dee] ring-4 ring-[#e8f3ff]' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
          }`}>
            <Building2 className={`w-5 h-5 shrink-0 ${cust ? 'text-[#5a8dee]' : 'text-slate-400'}`} />
            <div className="flex-1 min-w-0">
              <Select
                variant="bare"
                searchable
                value={selId}
                onChange={v => setSlot(i, v)}
                placeholder="-- Click chọn khách hàng --"
                options={[
                  { value: '', label: '-- Click chọn khách hàng --' },
                  ...chartableCustomers.map(c => ({ value: c.id, label: `[${c.mkh}] ${c.name}` })),
                ]}
              />
            </div>
          </div>

          {/* Dropdown trạm (khi nhiều điểm đo) + thông tin P max */}
          {cust && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              {multiStation ? (
                <div className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-[#5a8dee] shrink-0" />
                  <Select
                    value={effMeter}
                    onChange={v => setStation(i, v)}
                    className="min-w-[160px]"
                    options={stations.map(s => ({ value: s.meterNo, label: stationLabel(s) }))}
                  />
                </div>
              ) : station && (
                <span className="inline-flex items-center gap-1 font-mono font-bold text-[#5a8dee] bg-[#e8f3ff] px-1.5 py-0.5 rounded">
                  <Gauge className="w-3 h-3" /> {stationLabel(station)}
                </span>
              )}
              {station && (
                <span className="font-mono">
                  P max: <strong className="text-amber-600">{fmtVal(station.peakP)} kW</strong>
                  {station.peakLabel && <span className="text-slate-400"> @ {station.peakLabel}</span>}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Biểu đồ — 1 trạm */}
        <div className="w-full text-slate-700 h-[280px]">
          {station && station.data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={station.data} margin={{ top: 22, right: 10, left: 2, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  stroke="#94a3b8"
                  style={{ fontSize: '10px', fontWeight: 'bold' }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  yAxisId="v"
                  tickLine={false}
                  stroke="#94a3b8"
                  style={{ fontSize: '10px' }}
                  width={40}
                  label={{ value: 'V', position: 'top', offset: 8, style: { fontSize: 10, fill: '#94a3b8' } }}
                />
                <YAxis
                  yAxisId="p"
                  orientation="right"
                  tickLine={false}
                  stroke="#818cf8"
                  style={{ fontSize: '10px' }}
                  width={40}
                  label={{ value: 'kW', position: 'top', offset: 8, style: { fontSize: 10, fill: '#818cf8' } }}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: 'rgba(226, 232, 240, 0.35)' }}
                  wrapperStyle={{ zIndex: 60, outline: 'none' }}
                />

                {/* Cột công suất P (kW) — trục phải */}
                <Bar yAxisId="p" dataKey="p" name="P (kW)" fill={P_FILL} radius={[2, 2, 0, 0]} maxBarSize={10} />

                {/* Mốc đạt P max của trạm */}
                {station.peakLabel && (
                  <ReferenceLine
                    yAxisId="p"
                    x={station.peakLabel}
                    stroke="#ec4899"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{
                      value: `P max ${fmtVal(station.peakP)} kW`,
                      position: 'top',
                      fontSize: 9,
                      fontWeight: 700,
                      fill: '#be185d',
                    }}
                  />
                )}

                {/* 3 đường điện áp pha — trục trái */}
                <Line yAxisId="v" type="monotone" dataKey="ua" name="Ua" stroke={PHASE_COLOR.ua} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                <Line yAxisId="v" type="monotone" dataKey="ub" name="Ub" stroke={PHASE_COLOR.ub} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                <Line yAxisId="v" type="monotone" dataKey="uc" name="Uc" stroke={PHASE_COLOR.uc} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <HelpCircle className="w-7 h-7 text-slate-300 mb-2 animate-pulse" />
              <p className="text-xs font-semibold text-center px-2">
                {selId ? 'Khách hàng này không có dữ liệu điện áp trong ngày' : 'Vui lòng chọn khách hàng'}
              </p>
            </div>
          )}
        </div>

        {station && station.data.length > 0 && <ChartLegend />}
      </div>
    );
  };

  /* ================================================================
     RENDER
  ================================================================ */
  return (
    <div className="space-y-8 pb-12 animate-fade-in">

      {/* ---- Header ---- */}
      <div className="vl-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-[#e8f3ff] rounded-2xl text-[#5a8dee]">
              <Activity className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">
              Đồ thị điện áp &amp; công suất
            </h1>
          </div>
          <p className="text-sm text-slate-500 max-w-2xl">
            Biểu đồ kết hợp theo <strong>thời gian thực tế</strong> của số liệu đo cho từng <strong>trạm</strong>:{' '}
            <strong>điện áp 3 pha (đường)</strong> và <strong>công suất P&nbsp;(kW) (cột)</strong>. Mặc định hiển thị
            3 khách có P&nbsp;max cao nhất và 3 khách thấp nhất; khách nhiều điểm đo có thể chọn trạm qua dropdown.
          </p>
        </div>

        {/* Date selector */}
        <div className="shrink-0">
          <DatePicker
            value={selectedDate}
            onChange={setSelectedDate}
            label="Ngày hiển thị"
            className="w-[200px]"
          />
          {dateKeys.length > 0 && (
            <p className="text-[11px] text-slate-400 mt-1.5 font-medium">
              Có dữ liệu: {fmtDateVN(dateKeys[0])} – {fmtDateVN(dateKeys[dateKeys.length - 1])}
            </p>
          )}
        </div>
      </div>

      {/* ---- Ghi chú về độ trễ & thời gian lưu dữ liệu ---- */}
      <div className="vl-alert vl-alert-light-warning flex items-start gap-3 p-4 rounded-xl">
        <Info className="w-5 h-5 shrink-0 mt-0.5" />
        <p className="text-sm leading-relaxed">
          Thông số vận hành sẽ lấy dữ liệu chậm hơn so với HES khoảng <strong>1 đến 2 giờ</strong> và chỉ lưu
          trong vòng <strong>7 ngày gần nhất</strong>.
        </p>
      </div>

      {/* ---- Trạng thái tải / lỗi / rỗng ---- */}
      {csvError && (
        <div className="vl-alert vl-alert-danger p-4 rounded-xl text-sm">{csvError}</div>
      )}

      {!isReady && !csvError && (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-slate-400">
          <Gauge className="w-12 h-12 mb-3 animate-pulse opacity-40" />
          <p className="font-semibold">Đang tải dữ liệu đo xa &amp; danh sách công tơ…</p>
        </div>
      )}

      {noData && (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-slate-400">
          <HelpCircle className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-semibold">Không có khách hàng nào đủ điều kiện vẽ biểu đồ</p>
          <p className="text-sm mt-1">
            (cần có công tơ với điện áp 3 pha &gt; 0 trong ngày {fmtDateVN(selectedDate)})
          </p>
        </div>
      )}

      {/* ---- Lưới 6 biểu đồ kích thước bằng nhau (hàng trên: cao nhất, hàng dưới: thấp nhất) ---- */}
      {isReady && !noData && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[0, 1, 2, 3, 4, 5].map(i => renderCard(i))}
        </div>
      )}
    </div>
  );
}
