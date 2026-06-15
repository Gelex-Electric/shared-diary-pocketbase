import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Bar,
  Line,
} from 'recharts';
import {
  Activity,
  Building2,
  HelpCircle,
  Info,
  Gauge,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { pb } from '../lib/pocketbase';
import { Meter } from '../types';
import { DatePicker } from './ui/DateTimePickers';

/* ================================================================
   CACHE CSV (module-level) — datametter.csv chỉ tải 1 lần/phiên.
   Giống cơ chế trong SummaryDashboard nhưng cho file đo xa.
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
      _meterCsvPromise = null; // cho phép thử lại lần sau nếu lỗi
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
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};

const fmtNum = (v: number, digits = 0) =>
  new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(v);

/**
 * Quy tắc làm tròn theo giờ (yêu cầu nghiệp vụ):
 *  - Phút trong [0..10]  → làm tròn XUỐNG giờ hiện tại.
 *  - Phút trong [50..60] → làm tròn LÊN giờ kế tiếp.
 *  - Còn lại (11..49, ví dụ mốc :30) → bỏ qua, không thuộc mốc giờ nào.
 * Trả về { dateKey, hour, offset } với offset = khoảng lệch (phút) tới mốc giờ,
 * dùng để chọn bản ghi gần mốc nhất khi có nhiều bản ghi cùng rơi vào 1 giờ.
 */
function roundToHour(dt: Date): { dateKey: string; hour: number; offset: number } | null {
  const m = dt.getMinutes();
  const d = new Date(dt);
  d.setSeconds(0, 0);
  if (m <= 10) {
    d.setMinutes(0);
    return { dateKey: fmtDateKey(d), hour: d.getHours(), offset: m };
  }
  if (m >= 50) {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1); // setHours tự cuộn sang ngày kế tiếp nếu cần
    return { dateKey: fmtDateKey(d), hour: d.getHours(), offset: 60 - m };
  }
  return null;
}

/* ================================================================
   TYPES nội bộ
================================================================ */
interface RawReading {
  meterNo: string;
  dateKey: string;
  hour: number;
  ua: number;
  ub: number;
  uc: number;
  kw: number;
}

interface HourCell {
  ua: number;
  ub: number;
  uc: number;
  kw: number;
  offset: number;
}

// meterNo -> dateKey -> hour -> cell
type ReadingIndex = Map<string, Map<string, Map<number, HourCell>>>;

interface CustomerInfo {
  id: string;
  mkh: string;
  name: string;
  meters: { meterNo: string; line: string }[];
}

interface ChartMeter {
  idx: number;
  meterNo: string;
  line: string;
}

interface CustomerChart {
  id: string;
  mkh: string;
  name: string;
  totalP: number;            // tổng P (kW) trong ngày — dùng để xếp hạng
  chartMeters: ChartMeter[]; // các công tơ có điện áp > 0
  data: any[];               // dữ liệu theo giờ cho ComposedChart
}

/* ================================================================
   MÀU SẮC — mỗi pha một tông, mỗi công tơ một sắc độ khác nhau.
================================================================ */
const PHASE_A = ['#dc2626', '#f87171', '#fca5a5', '#fecaca']; // đỏ
const PHASE_B = ['#16a34a', '#4ade80', '#86efac', '#bbf7d0']; // xanh lá
const PHASE_C = ['#2563eb', '#60a5fa', '#93c5fd', '#bfdbfe']; // xanh dương
const P_FILLS = ['#a5b4fc', '#c4b5fd', '#fbcfe8', '#fde68a']; // cột P (kW) — tông nhạt

const pick = (arr: string[], i: number) => arr[i % arr.length];

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

  /* ---- Phân tích CSV → chỉ mục theo công tơ / ngày / giờ ---- */
  const { readingIndex, dateKeys, defaultDate } = useMemo(() => {
    const index: ReadingIndex = new Map();
    const dateCount = new Map<string, number>();

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

        const rounded = roundToHour(dt);
        if (!rounded) continue; // mốc :30 hoặc lệch giữa giờ → bỏ

        const reading: RawReading = {
          meterNo,
          dateKey: rounded.dateKey,
          hour: rounded.hour,
          ua: parseFloat(cols[2]) || 0,
          ub: parseFloat(cols[3]) || 0,
          uc: parseFloat(cols[4]) || 0,
          kw: parseFloat(cols[5]) || 0,
        };

        let byDate = index.get(meterNo);
        if (!byDate) { byDate = new Map(); index.set(meterNo, byDate); }
        let byHour = byDate.get(reading.dateKey);
        if (!byHour) { byHour = new Map(); byDate.set(reading.dateKey, byHour); }

        const existing = byHour.get(reading.hour);
        // Giữ bản ghi gần mốc giờ nhất (offset nhỏ nhất)
        if (!existing || rounded.offset < existing.offset) {
          byHour.set(reading.hour, {
            ua: reading.ua, ub: reading.ub, uc: reading.uc, kw: reading.kw,
            offset: rounded.offset,
          });
        }

        dateCount.set(reading.dateKey, (dateCount.get(reading.dateKey) || 0) + 1);
      }
    }

    const keys = Array.from(dateCount.keys()).sort();
    // Ngày mặc định = ngày có nhiều bản ghi nhất (đầy đủ nhất)
    let best = '';
    let bestN = -1;
    for (const [k, n] of dateCount) {
      if (n > bestN) { bestN = n; best = k; }
    }
    return { readingIndex: index, dateKeys: keys, defaultDate: best };
  }, [csvContent]);

  /* ---- Ngày đang chọn ---- */
  const [selectedDate, setSelectedDate] = useState<string>('');
  useEffect(() => {
    if (defaultDate && !selectedDate) setSelectedDate(defaultDate);
  }, [defaultDate, selectedDate]);

  /* ---- Dựng dữ liệu biểu đồ cho từng khách hàng theo ngày chọn ---- */
  const chartableCustomers = useMemo<CustomerChart[]>(() => {
    if (!selectedDate) return [];
    const result: CustomerChart[] = [];

    for (const info of customerInfoMap.values()) {
      const chartMeters: ChartMeter[] = [];
      const meterHourly: Map<number, Map<number, HourCell>> = new Map(); // chartMeterIdx -> hour -> cell
      const hoursSet = new Set<number>();
      let totalP = 0;

      let idxCounter = 0;
      for (const m of info.meters) {
        const byDate = readingIndex.get(m.meterNo);
        const byHour = byDate?.get(selectedDate);
        if (!byHour || byHour.size === 0) continue;

        // Công tơ chỉ được vẽ khi có điện áp 3 pha > 0 (ít nhất 1 mốc giờ)
        let hasVoltage = false;
        for (const cell of byHour.values()) {
          if (cell.ua > 0 && cell.ub > 0 && cell.uc > 0) { hasVoltage = true; break; }
        }
        if (!hasVoltage) continue;

        const idx = idxCounter++;
        chartMeters.push({ idx, meterNo: m.meterNo, line: m.line });
        meterHourly.set(idx, byHour);
        for (const [h, cell] of byHour) {
          hoursSet.add(h);
          totalP += cell.kw;
        }
      }

      if (chartMeters.length === 0) continue; // khách không có điện áp > 0 → không vẽ

      const sortedHours = Array.from(hoursSet).sort((a, b) => a - b);
      const data = sortedHours.map(h => {
        const row: any = { hour: h, label: `${p2(h)}:00` };
        for (const cm of chartMeters) {
          const cell = meterHourly.get(cm.idx)!.get(h);
          row[`ua${cm.idx}`] = cell && cell.ua > 0 ? cell.ua : null;
          row[`ub${cm.idx}`] = cell && cell.ub > 0 ? cell.ub : null;
          row[`uc${cm.idx}`] = cell && cell.uc > 0 ? cell.uc : null;
          row[`p${cm.idx}`] = cell ? cell.kw : null;
        }
        return row;
      });

      result.push({
        id: info.id,
        mkh: info.mkh,
        name: info.name,
        totalP,
        chartMeters,
        data,
      });
    }

    // Xếp hạng theo P (kW) giảm dần
    result.sort((a, b) => b.totalP - a.totalP);
    return result;
  }, [selectedDate, customerInfoMap, readingIndex]);

  const chartById = useMemo(() => {
    const m = new Map<string, CustomerChart>();
    chartableCustomers.forEach(c => m.set(c.id, c));
    return m;
  }, [chartableCustomers]);

  /* ---- Lựa chọn mặc định: 2 biểu đồ đầu = P cao nhất, 2 sau = P thấp nhất ---- */
  const defaultPicks = useMemo<string[]>(() => {
    const ids = chartableCustomers.map(c => c.id);
    const picks: string[] = [];
    const used = new Set<string>();
    const push = (id?: string) => { if (id && !used.has(id)) { used.add(id); picks.push(id); } };
    push(ids[0]);                       // cao nhất
    push(ids[1]);                       // cao nhì
    push(ids[ids.length - 1]);          // thấp nhất
    push(ids[ids.length - 2]);          // thấp nhì
    for (const id of ids) { if (picks.length >= 4) break; push(id); } // bù nếu < 4
    while (picks.length < 4) picks.push('');
    return picks.slice(0, 4);
  }, [chartableCustomers]);

  /* ---- State 4 ô chọn khách hàng (sticky, reset khi đổi ngày/khu vực) ---- */
  const [slots, setSlots] = useState<string[]>(['', '', '', '']);
  const [stickyKey, setStickyKey] = useState<string>('');

  useEffect(() => {
    const key = `${selectedDate}_${userAreas.join('|')}_${chartableCustomers.length}`;
    if (key !== stickyKey) {
      setStickyKey(key);
      setSlots(defaultPicks);
    }
  }, [selectedDate, userAreas, chartableCustomers.length, defaultPicks, stickyKey]);

  const setSlot = (i: number, id: string) =>
    setSlots(prev => prev.map((v, idx) => (idx === i ? id : v)));

  const SLOT_META = [
    { title: 'Phụ tải cao nhất', Icon: TrendingUp, tone: 'text-rose-600' },
    { title: 'Phụ tải cao thứ 2', Icon: TrendingUp, tone: 'text-rose-500' },
    { title: 'Phụ tải thấp nhất', Icon: TrendingDown, tone: 'text-emerald-600' },
    { title: 'Phụ tải thấp thứ 2', Icon: TrendingDown, tone: 'text-emerald-500' },
  ];

  const isReady = !!csvContent && !isLoadingMeters;
  const noData = isReady && chartableCustomers.length === 0;

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
            Biểu đồ kết hợp theo giờ trong ngày: <strong>điện áp 3 pha (đường)</strong> và{' '}
            <strong>công suất P&nbsp;(kW) (cột)</strong> của khách hàng. Mặc định hiển thị 2 khách
            phụ tải cao nhất và 2 khách phụ tải thấp nhất.
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

      {/* ---- Ghi chú: CSV không có dòng điện ---- */}
      <div className="vl-alert vl-alert-primary flex items-start gap-3 p-4 rounded-xl">
        <Info className="w-5 h-5 shrink-0 mt-0.5" />
        <p className="text-sm leading-relaxed">
          Nguồn dữ liệu <code className="font-mono text-xs bg-white/40 px-1 py-0.5 rounded">datametter.csv</code> hiện
          chỉ có <strong>điện áp 3 pha</strong> và <strong>công suất P&nbsp;(kW)</strong>; chưa có cột dòng điện
          (Ia/Ib/Ic) nên biểu đồ chưa thể hiện dòng điện. Khi bổ sung cột dòng điện vào CSV, có thể mở rộng thêm.
          Các mốc giờ được làm tròn theo quy tắc: lệch 0–10 phút làm tròn xuống, 50–60 phút làm tròn lên.
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
            (cần có công tơ với điện áp 3 pha &gt; 0 trong ngày {selectedDate ? fmtDateVN(selectedDate) : ''})
          </p>
        </div>
      )}

      {/* ---- Lưới 4 biểu đồ ---- */}
      {isReady && !noData && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {slots.map((selId, i) => {
            const meta = SLOT_META[i];
            const chart = selId ? chartById.get(selId) : undefined;
            return (
              <div key={i} className="vl-card p-6 flex flex-col min-h-[480px]">
                {/* Tiêu đề + bộ chọn khách hàng */}
                <div className="flex flex-col gap-3 mb-5">
                  <div className="flex items-center gap-2">
                    <meta.Icon className={`w-4 h-4 ${meta.tone}`} />
                    <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase font-mono">
                      Biểu đồ {i + 1} · {meta.title}
                    </span>
                  </div>

                  <div className={`border rounded p-3 flex items-center gap-3 transition-colors ${
                    chart ? 'bg-[#f4f8ff] border-[#5a8dee] ring-4 ring-[#e8f3ff]'
                          : 'bg-slate-50 border-slate-200'
                  }`}>
                    <Building2 className={`w-5 h-5 shrink-0 ${chart ? 'text-[#5a8dee]' : 'text-slate-400'}`} />
                    <div className="flex-1 min-w-0">
                      <select
                        value={selId}
                        onChange={e => setSlot(i, e.target.value)}
                        className="vl-select w-full bg-transparent border-none text-slate-800 font-extrabold text-xs md:text-sm focus:outline-none cursor-pointer pr-8 truncate"
                      >
                        <option value="">-- Chọn khách hàng --</option>
                        {chartableCustomers.map(c => (
                          <option key={c.id} value={c.id}>
                            [{c.mkh}] {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {chart && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <Gauge className="w-3 h-3 text-[#5a8dee]" />
                        {chart.chartMeters.length} công tơ
                      </span>
                      <span className="font-mono">
                        Tổng P ngày: <strong className="text-slate-700">{fmtNum(chart.totalP, 1)} kW</strong>
                      </span>
                    </div>
                  )}
                </div>

                {/* Biểu đồ */}
                <div className="flex-1 min-h-[320px] w-full text-slate-700">
                  {chart && chart.data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chart.data} margin={{ top: 18, right: 12, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          stroke="#94a3b8"
                          style={{ fontSize: '10px', fontWeight: 'bold' }}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          yAxisId="v"
                          tickLine={false}
                          stroke="#94a3b8"
                          style={{ fontSize: '10px' }}
                          width={42}
                          label={{ value: 'V', angle: 0, position: 'top', offset: 8, style: { fontSize: 10, fill: '#94a3b8' } }}
                        />
                        <YAxis
                          yAxisId="p"
                          orientation="right"
                          tickLine={false}
                          stroke="#a5b4fc"
                          style={{ fontSize: '10px' }}
                          width={42}
                          label={{ value: 'kW', angle: 0, position: 'top', offset: 8, style: { fontSize: 10, fill: '#818cf8' } }}
                        />
                        <Tooltip
                          contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                          cursor={{ fill: 'rgba(226, 232, 240, 0.35)' }}
                          formatter={(value: any, name: any) => {
                            if (value == null) return ['—', name];
                            const isP = String(name).startsWith('P');
                            return [
                              `${fmtNum(Number(value), isP ? 2 : 1)} ${isP ? 'kW' : 'V'}`,
                              name,
                            ];
                          }}
                          labelFormatter={(l) => `Giờ ${l}`}
                        />
                        <Legend wrapperStyle={{ fontSize: '10px', paddingTop: 6 }} iconSize={9} />

                        {/* Cột P (kW) — trục phải. Nhiều công tơ → nhiều cột cạnh nhau cùng 1 giờ */}
                        {chart.chartMeters.map(cm => {
                          const suffix = chart.chartMeters.length > 1 ? ` ${cm.idx + 1}` : '';
                          return (
                            <Bar
                              key={`p${cm.idx}`}
                              yAxisId="p"
                              dataKey={`p${cm.idx}`}
                              name={`P${suffix} (kW)`}
                              fill={pick(P_FILLS, cm.idx)}
                              radius={[3, 3, 0, 0]}
                              barSize={chart.chartMeters.length > 1 ? 10 : 16}
                            />
                          );
                        })}

                        {/* Đường điện áp 3 pha — trục trái */}
                        {chart.chartMeters.flatMap(cm => {
                          const suffix = chart.chartMeters.length > 1 ? `${cm.idx + 1}` : '';
                          return [
                            <Line
                              key={`ua${cm.idx}`}
                              yAxisId="v"
                              type="monotone"
                              dataKey={`ua${cm.idx}`}
                              name={`Ua${suffix}`}
                              stroke={pick(PHASE_A, cm.idx)}
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 4 }}
                              connectNulls
                            />,
                            <Line
                              key={`ub${cm.idx}`}
                              yAxisId="v"
                              type="monotone"
                              dataKey={`ub${cm.idx}`}
                              name={`Ub${suffix}`}
                              stroke={pick(PHASE_B, cm.idx)}
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 4 }}
                              connectNulls
                            />,
                            <Line
                              key={`uc${cm.idx}`}
                              yAxisId="v"
                              type="monotone"
                              dataKey={`uc${cm.idx}`}
                              name={`Uc${suffix}`}
                              stroke={pick(PHASE_C, cm.idx)}
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 4 }}
                              connectNulls
                            />,
                          ];
                        })}
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                      <HelpCircle className="w-8 h-8 text-slate-300 mb-2 animate-pulse" />
                      <p className="text-xs font-semibold">
                        {selId ? 'Khách hàng này không có dữ liệu điện áp trong ngày' : 'Vui lòng chọn khách hàng'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
