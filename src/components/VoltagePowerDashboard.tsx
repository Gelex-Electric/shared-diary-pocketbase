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

const slotLabel = (slotMin: number) =>
  `${p2(Math.floor(slotMin / 60) % 24)}:${p2(slotMin % 60)}`;

const fmtNum = (v: number, digits = 0) =>
  new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(v);

/**
 * Làm tròn về mốc 30 phút gần nhất (yêu cầu nghiệp vụ, độ phân giải 30').
 *  - Phút [0..10]   → :00 (làm tròn xuống).
 *  - Phút [20..40]  → :30 (làm tròn về nửa giờ).
 *  - Phút [50..60]  → :00 giờ kế tiếp (làm tròn lên).
 *  - Còn lại (11..19, 41..49) → bỏ (không sát mốc nào).
 * Trả về { dateKey, slotMin, offset } với slotMin = phút trong ngày của mốc,
 * offset = độ lệch (phút) tới mốc — dùng chọn bản ghi gần mốc nhất.
 */
function roundToHalfHour(dt: Date): { dateKey: string; slotMin: number; offset: number } | null {
  const m = dt.getMinutes();
  const d = new Date(dt);
  d.setSeconds(0, 0);

  if (m <= 10) {
    d.setMinutes(0);
    return { dateKey: fmtDateKey(d), slotMin: d.getHours() * 60, offset: m };
  }
  if (m >= 20 && m <= 40) {
    d.setMinutes(30);
    return { dateKey: fmtDateKey(d), slotMin: d.getHours() * 60 + 30, offset: Math.abs(m - 30) };
  }
  if (m >= 50) {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1); // tự cuộn sang ngày kế tiếp nếu cần
    return { dateKey: fmtDateKey(d), slotMin: d.getHours() * 60, offset: 60 - m };
  }
  return null;
}

/* ================================================================
   TYPES nội bộ
================================================================ */
interface HourCell {
  ua: number;
  ub: number;
  uc: number;
  kw: number;
  offset: number;
}

// meterNo -> dateKey -> slotMin -> cell
type ReadingIndex = Map<string, Map<string, Map<number, HourCell>>>;

interface CustomerInfo {
  id: string;
  mkh: string;
  name: string;
  meters: { meterNo: string; line: string }[];
}

interface ChartMeter {
  idx: number;        // số thứ tự điểm đo trong biểu đồ (0-based)
  meterNo: string;
  line: string;
}

interface CustomerChart {
  id: string;
  mkh: string;
  name: string;
  peakP: number;       // P (kW) lớn nhất trong ngày (tổng các điểm đo theo mốc) — dùng xếp hạng
  peakLabel: string;   // nhãn mốc thời gian đạt P max
  chartMeters: ChartMeter[];
  data: any[];
}

/* ================================================================
   MÀU SẮC — đồng bộ palette SummaryDashboard
   (slate #94a3b8, blue #3b82f6, green #10b981, amber #f59e0b, pink #ec4899).
   Pha = màu cố định; TRẠM phân biệt bằng kiểu nét đường + sắc độ cột.
================================================================ */
const PHASE_COLOR = { ua: '#3b82f6', ub: '#10b981', uc: '#f59e0b' }; // Ua xanh dương, Ub xanh lá, Uc hổ phách
const P_FILLS = ['#5a8dee', '#94a3b8', '#a5b4fc', '#ec4899'];        // cột P (kW) theo trạm
const DASHES = ['', '5 3', '2 3', '8 3 2 3'];                        // kiểu nét theo trạm

const pick = (arr: string[], i: number) => arr[i % arr.length];

/** Nhãn trạm để phân biệt điểm đo (vd: YM.KIMTIN.3000KVA.ECHO). */
const stationLabel = (cm: { line: string; meterNo: string }) => cm.line || cm.meterNo;

/* ================================================================
   TOOLTIP tuỳ biến — nền sáng, gom theo điểm đo.
================================================================ */
function parseSeriesKey(key: string): { kind: 'ua' | 'ub' | 'uc' | 'p'; idx: number } | null {
  const m = key.match(/^(ua|ub|uc|p)(\d+)$/);
  if (!m) return null;
  return { kind: m[1] as any, idx: Number(m[2]) };
}

const PHASE_LABEL: Record<string, string> = { ua: 'Ua', ub: 'Ub', uc: 'Uc', p: 'P' };

function ChartTooltip({ active, payload, label, chartMeters }: any) {
  if (!active || !payload || payload.length === 0) return null;

  const multi = chartMeters.length > 1;
  const groups = new Map<number, any[]>();
  for (const p of payload) {
    if (p.value == null) continue;
    const info = parseSeriesKey(p.dataKey);
    if (!info) continue;
    if (!groups.has(info.idx)) groups.set(info.idx, []);
    groups.get(info.idx)!.push({ ...p, info });
  }
  if (groups.size === 0) return null;

  const ordered = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);

  return (
    <div className="vl-chart-tooltip">
      <div className="vl-chart-tooltip-title">Thời điểm {label}</div>
      {ordered.map(([idx, items]) => {
        const cm: ChartMeter | undefined = chartMeters.find((c: ChartMeter) => c.idx === idx);
        return (
          <div key={idx} className="vl-chart-tooltip-group">
            {multi && cm && (
              <div className="vl-chart-tooltip-meter">{stationLabel(cm)}</div>
            )}
            {items
              .sort((a, b) => (a.info.kind === 'p' ? 1 : 0) - (b.info.kind === 'p' ? 1 : 0))
              .map((it, i) => {
                const isP = it.info.kind === 'p';
                return (
                  <div key={i} className="vl-chart-tooltip-row">
                    <span className="vl-dot" style={{ background: it.color }} />
                    <span className="vl-lbl">{PHASE_LABEL[it.info.kind]}</span>
                    <span className="vl-val">
                      {fmtNum(Number(it.value), isP ? 2 : 1)} {isP ? 'kW' : 'V'}
                    </span>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================
   LEGEND tuỳ biến — gom theo TRẠM, hiển thị màu pha + kiểu nét + cột P.
================================================================ */
function DashLine({ color, dash }: { color: string; dash: string }) {
  return (
    <svg width="20" height="6" className="shrink-0">
      <line x1="0" y1="3" x2="20" y2="3" stroke={color} strokeWidth="2.2" strokeDasharray={dash || undefined} />
    </svg>
  );
}

function StationLegend({ chartMeters }: { chartMeters: ChartMeter[] }) {
  const multi = chartMeters.length > 1;
  return (
    <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-slate-100">
      {chartMeters.map(cm => {
        const dash = pick(DASHES, cm.idx);
        return (
          <div key={cm.idx} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-500">
            {multi && (
              <span className="font-mono font-bold text-[#5a8dee] bg-[#e8f3ff] px-1.5 py-0.5 rounded">
                {stationLabel(cm)}
              </span>
            )}
            <span className="inline-flex items-center gap-1"><DashLine color={PHASE_COLOR.ua} dash={dash} /> Ua</span>
            <span className="inline-flex items-center gap-1"><DashLine color={PHASE_COLOR.ub} dash={dash} /> Ub</span>
            <span className="inline-flex items-center gap-1"><DashLine color={PHASE_COLOR.uc} dash={dash} /> Uc</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ background: pick(P_FILLS, cm.idx) }} /> P (kW)
            </span>
          </div>
        );
      })}
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

  /* ---- Phân tích CSV → chỉ mục theo công tơ / ngày / mốc 30' ---- */
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

        const rounded = roundToHalfHour(dt);
        if (!rounded) continue;

        const cell: HourCell = {
          ua: parseFloat(cols[2]) || 0,
          ub: parseFloat(cols[3]) || 0,
          uc: parseFloat(cols[4]) || 0,
          kw: parseFloat(cols[5]) || 0,
          offset: rounded.offset,
        };

        let byDate = index.get(meterNo);
        if (!byDate) { byDate = new Map(); index.set(meterNo, byDate); }
        let bySlot = byDate.get(rounded.dateKey);
        if (!bySlot) { bySlot = new Map(); byDate.set(rounded.dateKey, bySlot); }

        const existing = bySlot.get(rounded.slotMin);
        if (!existing || rounded.offset < existing.offset) {
          bySlot.set(rounded.slotMin, cell);
        }
        dateSet.add(rounded.dateKey);
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

  /* ---- Dựng dữ liệu biểu đồ cho từng khách hàng theo ngày chọn ---- */
  const chartableCustomers = useMemo<CustomerChart[]>(() => {
    if (!selectedDate) return [];
    const result: CustomerChart[] = [];

    for (const info of customerInfoMap.values()) {
      const chartMeters: ChartMeter[] = [];
      const meterBySlot: Map<number, Map<number, HourCell>> = new Map(); // idx -> slotMin -> cell
      const slotsSet = new Set<number>();

      let idxCounter = 0;
      for (const m of info.meters) {
        const bySlot = readingIndex.get(m.meterNo)?.get(selectedDate);
        if (!bySlot || bySlot.size === 0) continue;

        // Công tơ chỉ vẽ khi có điện áp 3 pha > 0 (ít nhất 1 mốc)
        let hasVoltage = false;
        for (const cell of bySlot.values()) {
          if (cell.ua > 0 && cell.ub > 0 && cell.uc > 0) { hasVoltage = true; break; }
        }
        if (!hasVoltage) continue;

        const idx = idxCounter++;
        chartMeters.push({ idx, meterNo: m.meterNo, line: m.line });
        meterBySlot.set(idx, bySlot);
        for (const s of bySlot.keys()) slotsSet.add(s);
      }

      if (chartMeters.length === 0) continue;

      const sortedSlots = Array.from(slotsSet).sort((a, b) => a - b);
      let peakP = 0;
      let peakLabel = '';

      const data = sortedSlots.map(s => {
        const row: any = { slot: s, label: slotLabel(s) };
        let slotSumP = 0;
        for (const cm of chartMeters) {
          const cell = meterBySlot.get(cm.idx)!.get(s);
          row[`ua${cm.idx}`] = cell && cell.ua > 0 ? cell.ua : null;
          row[`ub${cm.idx}`] = cell && cell.ub > 0 ? cell.ub : null;
          row[`uc${cm.idx}`] = cell && cell.uc > 0 ? cell.uc : null;
          row[`p${cm.idx}`] = cell ? cell.kw : null;
          if (cell) slotSumP += cell.kw;
        }
        if (slotSumP > peakP) { peakP = slotSumP; peakLabel = row.label; }
        return row;
      });

      result.push({
        id: info.id,
        mkh: info.mkh,
        name: info.name,
        peakP,
        peakLabel,
        chartMeters,
        data,
      });
    }

    // Xếp hạng theo P MAX giảm dần
    result.sort((a, b) => b.peakP - a.peakP);
    return result;
  }, [selectedDate, customerInfoMap, readingIndex]);

  const chartById = useMemo(() => {
    const m = new Map<string, CustomerChart>();
    chartableCustomers.forEach(c => m.set(c.id, c));
    return m;
  }, [chartableCustomers]);

  /* ---- Mặc định: 2 biểu đồ đầu = P max cao nhất, 2 sau = P max thấp nhất ---- */
  const defaultPicks = useMemo<string[]>(() => {
    const ids = chartableCustomers.map(c => c.id);
    const picks: string[] = [];
    const used = new Set<string>();
    const push = (id?: string) => { if (id && !used.has(id)) { used.add(id); picks.push(id); } };
    push(ids[0]);
    push(ids[1]);
    push(ids[ids.length - 1]);
    push(ids[ids.length - 2]);
    for (const id of ids) { if (picks.length >= 4) break; push(id); }
    while (picks.length < 4) picks.push('');
    return picks.slice(0, 4);
  }, [chartableCustomers]);

  /* ---- 4 ô chọn khách hàng (sticky, reset khi đổi ngày/khu vực) ---- */
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
    { title: 'P max cao nhất', Icon: TrendingUp, tone: 'text-rose-600' },
    { title: 'P max cao thứ 2', Icon: TrendingUp, tone: 'text-rose-500' },
    { title: 'P max thấp nhất', Icon: TrendingDown, tone: 'text-emerald-600' },
    { title: 'P max thấp thứ 2', Icon: TrendingDown, tone: 'text-emerald-500' },
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
            Biểu đồ kết hợp theo mốc <strong>30 phút</strong>: <strong>điện áp 3 pha (đường)</strong> và{' '}
            <strong>công suất P&nbsp;(kW) (cột)</strong>. Mặc định hiển thị 2 khách có P&nbsp;max cao nhất và
            2 khách có P&nbsp;max thấp nhất; mốc đạt P&nbsp;max được đánh dấu trên biểu đồ.
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

      {/* ---- Lưới 4 biểu đồ ---- */}
      {isReady && !noData && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {slots.map((selId, i) => {
            const meta = SLOT_META[i];
            const chart = selId ? chartById.get(selId) : undefined;
            const multi = !!chart && chart.chartMeters.length > 1;
            return (
              <div key={i} className="vl-card p-6 flex flex-col min-h-[500px]">
                {/* Tiêu đề + bộ chọn khách hàng */}
                <div className="flex flex-col gap-3 mb-5">
                  <div className="flex items-center gap-2">
                    <meta.Icon className={`w-4 h-4 ${meta.tone}`} />
                    <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase font-mono">
                      Biểu đồ {i + 1} · {meta.title}
                    </span>
                  </div>

                  {/* Bộ chọn khách hàng — đồng bộ kiểu hộp viền xanh của SummaryDashboard */}
                  <div className={`border rounded p-3 flex items-center gap-3 transition-colors ${
                    chart
                      ? 'bg-[#f4f8ff] border-[#5a8dee] ring-4 ring-[#e8f3ff]'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                  }`}>
                    <Building2 className={`w-5 h-5 shrink-0 ${chart ? 'text-[#5a8dee]' : 'text-slate-400'}`} />
                    <div className="flex-1 min-w-0">
                      <select
                        value={selId}
                        onChange={e => setSlot(i, e.target.value)}
                        className="vl-select w-full bg-transparent border-none text-slate-800 font-extrabold text-xs md:text-sm focus:outline-none cursor-pointer pr-8 truncate"
                      >
                        <option value="">-- Click chọn khách hàng --</option>
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
                        {chart.chartMeters.length} trạm
                      </span>
                      <span className="font-mono">
                        P max ngày: <strong className="text-amber-600">{fmtNum(chart.peakP, 1)} kW</strong>
                        {chart.peakLabel && <span className="text-slate-400"> @ {chart.peakLabel}</span>}
                      </span>
                    </div>
                  )}
                </div>

                {/* Biểu đồ */}
                <div className="flex-1 min-h-[330px] w-full text-slate-700">
                  {chart && chart.data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chart.data} margin={{ top: 22, right: 12, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          stroke="#94a3b8"
                          style={{ fontSize: '10px', fontWeight: 'bold' }}
                          interval="preserveStartEnd"
                          minTickGap={18}
                        />
                        <YAxis
                          yAxisId="v"
                          tickLine={false}
                          stroke="#94a3b8"
                          style={{ fontSize: '10px' }}
                          width={42}
                          label={{ value: 'V', position: 'top', offset: 8, style: { fontSize: 10, fill: '#94a3b8' } }}
                        />
                        <YAxis
                          yAxisId="p"
                          orientation="right"
                          tickLine={false}
                          stroke="#818cf8"
                          style={{ fontSize: '10px' }}
                          width={42}
                          label={{ value: 'kW', position: 'top', offset: 8, style: { fontSize: 10, fill: '#818cf8' } }}
                        />
                        <Tooltip
                          content={<ChartTooltip chartMeters={chart.chartMeters} />}
                          cursor={{ fill: 'rgba(226, 232, 240, 0.35)' }}
                          wrapperStyle={{ zIndex: 60, outline: 'none' }}
                        />
                        {/* Cột P (kW) — trục phải. Nhiều trạm → nhiều cột cạnh nhau cùng 1 mốc */}
                        {chart.chartMeters.map(cm => (
                          <Bar
                            key={`p${cm.idx}`}
                            yAxisId="p"
                            dataKey={`p${cm.idx}`}
                            name={multi ? `P (${stationLabel(cm)})` : 'P (kW)'}
                            fill={pick(P_FILLS, cm.idx)}
                            radius={[3, 3, 0, 0]}
                            barSize={multi ? 8 : 14}
                          />
                        ))}

                        {/* Đánh dấu mốc đạt P max của khách hàng */}
                        {chart.peakLabel && (
                          <ReferenceLine
                            yAxisId="p"
                            x={chart.peakLabel}
                            stroke="#ec4899"
                            strokeDasharray="4 3"
                            strokeWidth={1.5}
                            label={{
                              value: `P max ${fmtNum(chart.peakP, 1)} kW`,
                              position: 'top',
                              fontSize: 9,
                              fontWeight: 700,
                              fill: '#be185d',
                            }}
                          />
                        )}

                        {/* Đường điện áp 3 pha — trục trái. Pha = màu, TRẠM = kiểu nét */}
                        {chart.chartMeters.flatMap(cm => {
                          const mp = multi ? ` (${stationLabel(cm)})` : '';
                          const dash = pick(DASHES, cm.idx);
                          return [
                            <Line
                              key={`ua${cm.idx}`}
                              yAxisId="v"
                              type="monotone"
                              dataKey={`ua${cm.idx}`}
                              name={`Ua${mp}`}
                              stroke={PHASE_COLOR.ua}
                              strokeWidth={2}
                              strokeDasharray={dash || undefined}
                              dot={false}
                              activeDot={{ r: 4 }}
                              connectNulls
                            />,
                            <Line
                              key={`ub${cm.idx}`}
                              yAxisId="v"
                              type="monotone"
                              dataKey={`ub${cm.idx}`}
                              name={`Ub${mp}`}
                              stroke={PHASE_COLOR.ub}
                              strokeWidth={2}
                              strokeDasharray={dash || undefined}
                              dot={false}
                              activeDot={{ r: 4 }}
                              connectNulls
                            />,
                            <Line
                              key={`uc${cm.idx}`}
                              yAxisId="v"
                              type="monotone"
                              dataKey={`uc${cm.idx}`}
                              name={`Uc${mp}`}
                              stroke={PHASE_COLOR.uc}
                              strokeWidth={2}
                              strokeDasharray={dash || undefined}
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

                {/* Chú giải — gom theo trạm */}
                {chart && chart.data.length > 0 && (
                  <StationLegend chartMeters={chart.chartMeters} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
