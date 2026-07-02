import { useState, useMemo, useEffect } from 'react';
import { toast as notify } from '../lib/toast';
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Bar,
  Line,
  ReferenceArea,
  Cell,
} from 'recharts';
import {
  Activity,
  Building2,
  HelpCircle,
  Gauge,
  Info,
  TrendingUp,
  TrendingDown,
  ZapOff,
} from 'lucide-react';
import { pb, ID_TO_AREA } from '../lib/pocketbase';
import { fetchMeterInfo, MeterInfoRow } from '../lib/meterInfo';
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

/** Tính thời lượng từ hai nhãn HH:mm, trả về chuỗi vd '1h30p', '45p'. */
function fmtDuration(x1: string, x2: string): string {
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const diff = toMin(x2) - toMin(x1);
  if (diff <= 0) return '';
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h > 0 && m > 0 ? `${h}h${m}p` : h > 0 ? `${h}h` : `${m}p`;
}

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
  outagePeriods: { x1: string; x2: string }[]; // khoảng thời gian UA=UB=UC=0
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
const PHASE_COLOR = { ua: 'var(--accent)', ub: '#10b981', uc: '#f59e0b' }; // Ua xanh dương, Ub xanh lá, Uc hổ phách
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

function ChartLegend({ hasOutages }: { hasOutages: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-3 border-t border-[var(--border)] text-[10px] font-semibold text-soft">
      <span className="inline-flex items-center gap-1"><LineSwatch color={PHASE_COLOR.ua} /> Ua</span>
      <span className="inline-flex items-center gap-1"><LineSwatch color={PHASE_COLOR.ub} /> Ub</span>
      <span className="inline-flex items-center gap-1"><LineSwatch color={PHASE_COLOR.uc} /> Uc</span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded-sm" style={{ background: P_FILL }} /> P (kW)
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded-sm" style={{ background: '#f43f5e' }} /> P max
      </span>
      {hasOutages && (
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm" style={{ background: '#fca5a5' }} /> Mất điện
        </span>
      )}
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

  // Lỗi đọc dữ liệu → toast (thay cho banner inline cũ).
  useEffect(() => {
    if (csvError) notify.error('Lỗi dữ liệu', csvError);
  }, [csvError]);

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

  /* ---- Khách hàng & công tơ từ metterinfo.csv (lọc theo KCN) ---- */
  const [meterRows, setMeterRows] = useState<MeterInfoRow[]>([]);
  const [isLoadingMeters, setIsLoadingMeters] = useState(true);

  /** Chuẩn hoá Unicode (NFC) + trim để so khớp area tiếng Việt an toàn. */
  const normArea = (s: string) => (s || '').normalize('NFC').trim();

  const userAreas = useMemo(() => {
    const raw = pb.authStore.model?.area;
    const items = Array.isArray(raw)
      ? raw
      : typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
    // Map ID → tên hiển thị (nếu area lưu dạng ID) rồi chuẩn hoá để khớp ADDRESS trong CSV
    return items.map(item => normArea(ID_TO_AREA[item] || item));
  }, [JSON.stringify(pb.authStore.model?.area)]);

  useEffect(() => {
    let mounted = true;
    setIsLoadingMeters(true);
    fetchMeterInfo()
      .then(rows => { if (mounted) setMeterRows(rows); })
      .catch(err => console.error('Lỗi tải metterinfo.csv:', err))
      .finally(() => { if (mounted) setIsLoadingMeters(false); });
    return () => { mounted = false; };
  }, []);

  // customerId -> CustomerInfo (gồm danh sách công tơ của khách), lọc theo khu vực (KCN)
  const customerInfoMap = useMemo(() => {
    const map = new Map<string, CustomerInfo>();
    const allowed = userAreas.length > 0 ? new Set(userAreas) : null;
    for (const r of meterRows) {
      if (allowed && !allowed.has(normArea(r.ADDRESS))) continue;
      const cid = r.CUSTOMER_CODE || r.CUSTOMER_NAME;
      if (!cid) continue;
      if (!map.has(cid)) {
        map.set(cid, {
          id: cid,
          mkh: r.CUSTOMER_CODE || '?',
          name: r.CUSTOMER_NAME || 'Không rõ',
          meters: [],
        });
      }
      map.get(cid)!.meters.push({ meterNo: r.METER_NO, line: r.LINE_NAME || '' });
    }
    return map;
  }, [meterRows, userAreas]);

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
            ua: r.ua,   // giữ nguyên 0 để đường xuống đáy khi mất điện
            ub: r.ub,
            uc: r.uc,
            p: r.kw,
          };
        });

        // Phát hiện khoảng mất điện: đoạn liên tiếp UA=UB=UC=0
        const outagePeriods: { x1: string; x2: string }[] = [];
        let outStart: string | null = null;
        for (const r of sorted) {
          const isOut = r.ua === 0 && r.ub === 0 && r.uc === 0;
          if (isOut && outStart === null) {
            outStart = r.label;
          } else if (!isOut && outStart !== null) {
            outagePeriods.push({ x1: outStart, x2: r.label });
            outStart = null;
          }
        }
        if (outStart !== null && sorted.length > 0) {
          outagePeriods.push({ x1: outStart, x2: sorted[sorted.length - 1].label });
        }

        stations.push({ meterNo: m.meterNo, line: m.line, data, peakP, peakLabel, outagePeriods });
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

  /* ---- Mặc định: 3 biểu đồ trái = P max cao nhất, 3 phải = P max thấp nhất (nhưng > 0) ---- */
  const defaultPicks = useMemo<string[]>(() => {
    const ids = chartableCustomers.map(c => c.id);
    // chartableCustomers đã sắp theo peakP giảm dần → lọc P max > 0 rồi lấy từ cuối lên cho nhóm "thấp nhất"
    const positiveIds = chartableCustomers.filter(c => c.peakP > 0).map(c => c.id);
    const picks: string[] = [];
    const used = new Set<string>();
    const push = (id?: string) => { if (id && !used.has(id)) { used.add(id); picks.push(id); } };
    push(ids[0]);
    push(ids[1]);
    push(ids[2]);
    push(positiveIds[positiveIds.length - 1]);
    push(positiveIds[positiveIds.length - 2]);
    push(positiveIds[positiveIds.length - 3]);
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
    { title: 'P max thấp nhất', Icon: TrendingDown, tone: 'text-ok' },
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
            <span className="text-[10px] font-black text-faint tracking-wider uppercase font-mono">
              Biểu đồ {i + 1} · {meta.title}
            </span>
          </div>

          {/* Chọn khách hàng */}
          <div className={`border rounded p-2.5 flex items-center gap-2.5 transition-colors ${
            cust ? 'bg-accent-soft border-accent ring-4 ring-[var(--accent-soft)]' : 'bg-subtle border-[var(--border)] hover:border-[var(--border-strong)]'
          }`}>
            <Building2 className={`w-5 h-5 shrink-0 ${cust ? 'text-accent' : 'text-faint'}`} />
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
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-soft">
              {multiStation ? (
                <div className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-accent shrink-0" />
                  <Select
                    value={effMeter}
                    onChange={v => setStation(i, v)}
                    className="min-w-[160px]"
                    options={stations.map(s => ({ value: s.meterNo, label: stationLabel(s) }))}
                  />
                </div>
              ) : station && (
                <span className="inline-flex items-center gap-1 font-mono font-bold text-accent bg-accent-soft px-1.5 py-0.5 rounded">
                  <Gauge className="w-3 h-3" /> {stationLabel(station)}
                </span>
              )}
              {station && (
                <span className="font-mono">
                  P max: <strong className="text-warn">{fmtVal(station.peakP)} kW</strong>
                  {station.peakLabel && <span className="text-faint"> @ {station.peakLabel}</span>}
                </span>
              )}
              {station && station.outagePeriods.length > 0 && (
                <div className="flex flex-wrap gap-1 w-full mt-0.5">
                  {station.outagePeriods.map((op, idx) => {
                    const dur = fmtDuration(op.x1, op.x2);
                    return (
                      <span key={idx} className="inline-flex items-center gap-1 bg-[var(--danger-soft)] border border-red-200 text-bad text-[10px] font-mono px-1.5 py-0.5 rounded">
                        <ZapOff className="w-2.5 h-2.5 shrink-0" />
                        {op.x1}–{op.x2}{dur && <span className="text-red-400 ml-0.5">({dur})</span>}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Biểu đồ — 1 trạm */}
        <div className="w-full text-dim h-[280px]">
          {station && station.data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={station.data} margin={{ top: 16, right: 4, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  stroke="var(--text-4)"
                  style={{ fontSize: '10px', fontWeight: 'bold' }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis yAxisId="v" hide />
                <YAxis yAxisId="p" orientation="right" hide />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: 'rgba(226, 232, 240, 0.35)' }}
                  wrapperStyle={{ zIndex: 60, outline: 'none' }}
                />

                {/* Vùng mất điện (UA=UB=UC=0) — nền trước khi vẽ đường */}
                {station.outagePeriods.map((op, idx) => (
                  <ReferenceArea
                    key={`outage-${idx}`}
                    yAxisId="v"
                    x1={op.x1}
                    x2={op.x2}
                    fill="#fca5a5"
                    fillOpacity={0.25}
                    label={idx === 0
                      ? { value: 'Mất điện', position: 'insideTopLeft', fontSize: 9, fill: '#dc2626', fontWeight: 700 }
                      : undefined
                    }
                  />
                ))}

                {/* Cột công suất P (kW) — trục phải; cột P max đổi màu rose */}
                <Bar yAxisId="p" dataKey="p" name="P (kW)" radius={[2, 2, 0, 0]} maxBarSize={10}>
                  {station.data.map((entry: any, idx: number) => (
                    <Cell
                      key={`cell-${idx}`}
                      fill={entry.label === station.peakLabel ? '#f43f5e' : P_FILL}
                    />
                  ))}
                </Bar>

                {/* 3 đường điện áp pha — trục trái */}
                <Line yAxisId="v" type="monotone" dataKey="ua" name="Ua" stroke={PHASE_COLOR.ua} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line yAxisId="v" type="monotone" dataKey="ub" name="Ub" stroke={PHASE_COLOR.ub} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line yAxisId="v" type="monotone" dataKey="uc" name="Uc" stroke={PHASE_COLOR.uc} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-faint">
              <HelpCircle className="w-7 h-7 text-faint mb-2 animate-pulse" />
              <p className="text-xs font-semibold text-center px-2">
                {selId ? 'Khách hàng này không có dữ liệu điện áp trong ngày' : 'Vui lòng chọn khách hàng'}
              </p>
            </div>
          )}
        </div>

        {station && station.data.length > 0 && (
          <ChartLegend hasOutages={station.outagePeriods.length > 0} />
        )}
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
            <div className="p-2.5 bg-accent-soft rounded-2xl text-accent">
              <Activity className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-ink tracking-tight uppercase">
              Đồ thị điện áp &amp; công suất
            </h1>
          </div>
          <p className="text-sm text-soft max-w-2xl flex items-start gap-1.5">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            Thông số vận hành sẽ lấy dữ liệu chậm hơn so với HES khoảng{' '}
            <strong>1 đến 2 giờ</strong> và chỉ lưu trong vòng{' '}
            <strong>7 ngày gần nhất</strong>.
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
            <p className="text-[11px] text-faint mt-1.5 font-medium">
              Có dữ liệu: {fmtDateVN(dateKeys[0])} – {fmtDateVN(dateKeys[dateKeys.length - 1])}
            </p>
          )}
        </div>
      </div>

      {/* ---- Trạng thái tải / rỗng (lỗi hiển thị bằng toast) ---- */}
      {!isReady && !csvError && (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-faint">
          <Gauge className="w-12 h-12 mb-3 animate-pulse opacity-40" />
          <p className="font-semibold">Đang tải dữ liệu đo xa &amp; danh sách công tơ…</p>
        </div>
      )}

      {noData && (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-faint">
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
