import { useEffect, useMemo, useState, ReactNode } from 'react';
import {
  ResponsiveContainer, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Line,
} from 'recharts';
import {
  TrendingDown, Info, CalendarDays, CalendarRange, BarChart3, Building2, Zap, Gauge,
  ChevronDown, ArrowUpRight, ArrowDownRight, Minus, AlertTriangle,
} from 'lucide-react';
import { toast as notify } from '../lib/toast';
import { StatTile, EmptyState, ChartTooltip, CHART } from './ui/dashboard';
import { Tabs, TabItem } from './ui/Tabs';
import { Select } from './ui/Select';
import { DatePicker } from './ui/DateTimePickers';
import { fetchLoss30min, fetchLossDaily, fetchLossMonthly, Loss30minRow, LossDailyRow, LossMonthlyRow } from '../lib/transformerLoss';
import { fetchMeterInfo, MeterInfoRow } from '../lib/meterInfo';
import { fetchMbaInfo, buildMbaLookup, MbaParams } from '../lib/mbaInfo';

/** Ngưỡng cảnh báo tỷ lệ tổn thất tổng của khu công nghiệp (%). */
const ZONE_WARN_PCT = 1.5;

/* ================= helpers ================= */
const fmt = (v: number, d = 1) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(v);
const pct = (v: number) => `${fmt(v, 1)}%`;
/** Tỷ lệ tổn thất chuẩn = tổn thất / điện NHẬN (= sản lượng giao + tổn thất). Luôn < 100%. */
const ratio = (loss: number, output: number) => { const inp = output + loss; return inp > 0 ? (loss / inp) * 100 : 0; };
const dateVN = (k: string) => { const [y, m, d] = k.split('-'); return d ? `${d}/${m}/${y}` : k; };
const monthVN = (m: string) => { const [y, mm] = m.split('-'); return mm ? `Tháng ${mm}/${y}` : m; };
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'vi');
const byKcn = (a: { kcn: string }, b: { kcn: string }) => a.kcn.localeCompare(b.kcn, 'vi');
const pad2 = (n: number) => String(n).padStart(2, '0');
const yesterdayKey = () => {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const prevDay = (k: string) => {
  const [y, m, d] = (k || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
};

/** Màu mức đầy tải: đỏ < 20% (non tải); vàng 20–30%; xanh > 30%. */
function loadColor(p: number): string {
  if (p < 20) return 'var(--danger)';
  if (p <= 30) return 'var(--warning)';
  return 'var(--success)';
}
const lossPctColor = (p: number) => (p >= 5 ? 'var(--danger)' : p >= 2 ? 'var(--warning)' : 'var(--success)');

/* Badge % tổn thất nổi bật — dùng ở cả bảng ngày & tháng. */
function LossPctBadge({ v }: { v: number }) {
  const c = lossPctColor(v);
  return (
    <span className="inline-flex items-center justify-center min-w-[56px] px-2.5 py-1 rounded-full text-sm font-black tabular-nums"
      style={{ color: c, background: `color-mix(in srgb, ${c} 15%, transparent)` }}>{pct(v)}</span>
  );
}

function LoadBar({ value }: { value: number }) {
  const w = Math.max(0, Math.min(100, value));
  const color = loadColor(value);
  return (
    <div className="flex items-center gap-2 min-w-[130px]">
      <div className="relative h-2.5 flex-1 rounded-full bg-subtle overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold tabular-nums w-10 text-right" style={{ color }}>{fmt(value, 0)}%</span>
    </div>
  );
}

/* Δ tổn thất so với hôm qua — TĂNG = xấu (đỏ), GIẢM = tốt (xanh). */
function LossDelta({ d }: { d: number | null }) {
  const up = d != null && d > 0.0005, down = d != null && d < -0.0005;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums ${up ? 'text-bad' : down ? 'text-ok' : 'text-faint'}`}>
      <Icon className="w-3.5 h-3.5" />{d == null ? '—' : `${Math.abs(d * 100).toFixed(1)}%`}
    </span>
  );
}

/* Thẻ KCN thu gọn được — vỏ chung cho bảng ngày & bảng tháng. */
function ZoneCard({ kcn, count, capacity, loss, lossPct, collapsed, onToggle, children }: {
  kcn: string; count: number; capacity: number; loss: number; lossPct: number;
  collapsed: boolean; onToggle: () => void; children: ReactNode;
}) {
  const warn = lossPct > ZONE_WARN_PCT;
  return (
    <div className="vl-card overflow-hidden">
      <div onClick={onToggle}
        className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] px-5 md:px-7 py-4 flex items-center justify-between gap-3 cursor-pointer select-none">
        <div className="flex items-center gap-3 text-white min-w-0">
          <div className="p-2 bg-white/20 rounded-xl shrink-0"><Building2 className="w-5 h-5" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-base font-black tracking-tight leading-tight truncate">{kcn}</h3>
              {warn && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/90 text-[10px] font-black uppercase tracking-wide shrink-0" style={{ color: 'var(--danger)' }}>
                  <AlertTriangle className="w-3 h-3" /> Vượt {fmt(ZONE_WARN_PCT, 1)}%
                </span>
              )}
            </div>
            <p className="text-[11px] font-semibold text-white/80">{count} trạm · CSĐ {fmt(capacity, 0)} kVA</p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right hidden sm:block leading-tight">
            <div className="text-xs font-bold text-white tabular-nums">{fmt(loss)} <span className="font-normal text-white/70">kWh</span></div>
            <div className="text-xs font-bold text-white tabular-nums">{pct(lossPct)} <span className="font-normal text-white/70">tổn thất</span></div>
          </div>
          <ChevronDown className={`w-5 h-5 text-white transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
        </div>
      </div>
      {!collapsed && <div className="overflow-x-auto">{children}</div>}
    </div>
  );
}

/* ================= types ================= */
interface Slot { time: string; loss: number; load: number; p: number; output: number; lossPct: number; }
interface StationDay {
  code: string; name: string; kcn: string; sdm: number; active: boolean;
  output: number; loss: number; lossPct: number; maxLoad: number; delta: number | null;
}
interface ZoneDay { kcn: string; capacity: number; output: number; loss: number; lossPct: number; stations: StationDay[]; }
interface StationMonth { code: string; name: string; kcn: string; sdm: number; active: boolean; output: number; loss: number; noload: number; load: number; lossPct: number; }
interface ZoneMonth { kcn: string; capacity: number; output: number; loss: number; lossPct: number; stations: StationMonth[]; }

interface StationMeta { kcn: string; name: string; sdm: number; }

/** Slot 30 phút cho biểu đồ TRONG NGÀY (chỉ để vẽ hình dạng; số liệu báo cáo lấy file ngày). */
function slotsByStation(rows: Loss30minRow[], date: string) {
  const m = new Map<string, Slot[]>();
  for (const r of rows) {
    if (r.date !== date) continue;
    let s = m.get(r.code);
    if (!s) { s = []; m.set(r.code, s); }
    s.push({ time: r.time, loss: r.lossKwh, load: r.loadPct, p: r.p, output: r.outputKwh, lossPct: ratio(r.lossKwh, r.outputKwh) });
  }
  m.forEach(s => s.sort((a, b) => a.time.localeCompare(b.time)));
  return m;
}

/* ================= component ================= */
type View = 'table' | 'monthly' | 'chart';
const TABS: TabItem<View>[] = [
  { id: 'table', label: 'Theo trạm (ngày)', icon: CalendarDays },
  { id: 'monthly', label: 'Theo tháng', icon: CalendarRange },
  { id: 'chart', label: 'Biểu đồ', icon: BarChart3 },
];

export default function TransformerLossManager() {
  const [rows, setRows] = useState<Loss30minRow[]>([]);
  const [daily, setDaily] = useState<LossDailyRow[]>([]);
  const [monthly, setMonthly] = useState<LossMonthlyRow[]>([]);
  const [meters, setMeters] = useState<MeterInfoRow[]>([]);
  const [mba, setMba] = useState<MbaParams[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('table');
  const [selDate, setSelDate] = useState('');
  const [selMonth, setSelMonth] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let ok = true;
    setLoading(true);
    Promise.all([
      fetchLoss30min(), fetchLossDaily(), fetchLossMonthly(),
      fetchMeterInfo().catch(() => [] as MeterInfoRow[]),
      fetchMbaInfo().catch(() => [] as MbaParams[]),
    ])
      .then(([r, dy, mo, mi, mb]) => { if (ok) { setRows(r); setDaily(dy); setMonthly(mo); setMeters(mi); setMba(mb); } })
      .catch(e => { console.error(e); notify.error('Lỗi dữ liệu', e?.message || 'Không tải được tổn thất MBA.'); })
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, []);

  /**
   * Meta từng trạm CHÍNH có đủ P0 & PK (nền để hiển thị cả trạm không hoạt động).
   * Trạm không có đủ P0/PK => bỏ qua (không tính, không hiển thị).
   */
  const metaByCode = useMemo(() => {
    const lookup = buildMbaLookup(mba);
    const map = new Map<string, StationMeta>();
    for (const m of meters) {
      if ((m.ROLE || '').trim() !== 'chinh') continue;
      const code = (m.CODE || '').trim();
      if (!code || map.has(code)) continue;
      const p = lookup(code);
      if (!p || !p.hasParams) continue;   // không đủ Po/Pk => không tính
      map.set(code, { kcn: (m.ADDRESS || '').trim() || 'Khác', name: (m.LINE_NAME || '').trim() || code, sdm: p.sdm });
    }
    return map;
  }, [meters, mba]);

  const dates = useMemo(() => [...new Set(daily.map(r => r.date))].sort().reverse(), [daily]);
  useEffect(() => {
    if (dates.length) setSelDate(p => p || (dates.includes(yesterdayKey()) ? yesterdayKey() : dates[0]));
  }, [dates]);
  const months = useMemo(() => [...new Set(monthly.map(r => r.month))].sort().reverse(), [monthly]);
  useEffect(() => { if (months.length) setSelMonth(p => p || months[0]); }, [months]);

  /* ---- Gom theo NGÀY (bảng ngày + biểu đồ) — sắp theo TÊN TRẠM ---- */
  const { zones, kpi, stationsSorted, stationByCode, allStations } = useMemo(() => {
    const empty = {
      zones: [] as ZoneDay[], kpi: { loss: 0, output: 0, capacity: 0, pct: 0, n: 0 },
      stationsSorted: [] as StationDay[], stationByCode: new Map<string, StationDay>(), allStations: [] as StationDay[],
    };
    if (!selDate) return empty;
    const cur = new Map(daily.filter(r => r.date === selDate).map(r => [r.code, r]));
    const prev = new Map(daily.filter(r => r.date === prevDay(selDate)).map(r => [r.code, r]));
    const stations: StationDay[] = [];
    // Nền là toàn bộ trạm có đủ P0/PK => gồm cả trạm KHÔNG hoạt động (không có bản ghi hôm nay).
    metaByCode.forEach((meta, code) => {
      const s = cur.get(code);
      const prevLoss = prev.get(code)?.lossKwh;
      stations.push({
        code, name: meta.name, kcn: meta.kcn, sdm: meta.sdm, active: !!s,
        output: s?.outputKwh ?? 0, loss: s?.lossKwh ?? 0, lossPct: s?.lossPct ?? 0,
        maxLoad: s?.maxLoadPct ?? 0,
        delta: s && prevLoss != null && prevLoss > 0 ? (s.lossKwh - prevLoss) / prevLoss : null,
      });
    });
    const zmap = new Map<string, ZoneDay>();
    for (const st of stations) {
      let z = zmap.get(st.kcn);
      if (!z) { z = { kcn: st.kcn, capacity: 0, output: 0, loss: 0, lossPct: 0, stations: [] }; zmap.set(st.kcn, z); }
      z.capacity += st.sdm; z.output += st.output; z.loss += st.loss; z.stations.push(st);
    }
    const zones = [...zmap.values()].map(z => ({
      ...z, lossPct: ratio(z.loss, z.output), stations: z.stations.sort(byName),
    })).sort(byKcn);
    const loss = stations.reduce((s, x) => s + x.loss, 0);
    const output = stations.reduce((s, x) => s + x.output, 0);
    const capacity = stations.reduce((s, x) => s + x.sdm, 0);
    return {
      zones, kpi: { loss, output, capacity, pct: ratio(loss, output), n: stations.length },
      stationsSorted: [...stations].filter(s => s.active && s.output + s.loss > 0).sort((a, b) => a.lossPct - b.lossPct),
      stationByCode: new Map(stations.map(s => [s.code, s])),
      allStations: [...stations].sort(byName),
    };
  }, [daily, selDate, metaByCode]);

  /* Slot 30 phút cho biểu đồ trong ngày (chỉ vẽ hình dạng). */
  const slotsByCode = useMemo(() => slotsByStation(rows, selDate), [rows, selDate]);

  /* ---- Gom theo THÁNG — sắp theo TÊN TRẠM ---- */
  const { mZones, mKpi } = useMemo(() => {
    const rowsM = monthly.filter(r => r.month === selMonth);
    const byCode = new Map<string, LossMonthlyRow>();
    for (const r of rowsM) byCode.set(r.code, r);
    const stations: StationMonth[] = [];
    // Nền là toàn bộ trạm có đủ P0/PK => gồm cả trạm không hoạt động trong tháng.
    metaByCode.forEach((meta, code) => {
      const r = byCode.get(code);
      stations.push({
        code, name: meta.name, kcn: meta.kcn, sdm: meta.sdm, active: !!r,
        output: r?.outputKwh ?? 0, loss: r?.totalKwh ?? 0, noload: r?.noloadKwh ?? 0, load: r?.loadKwh ?? 0,
        lossPct: r ? ratio(r.totalKwh, r.outputKwh) : 0,
      });
    });
    const zmap = new Map<string, ZoneMonth>();
    for (const st of stations) {
      let z = zmap.get(st.kcn);
      if (!z) { z = { kcn: st.kcn, capacity: 0, output: 0, loss: 0, lossPct: 0, stations: [] }; zmap.set(st.kcn, z); }
      z.capacity += st.sdm; z.output += st.output; z.loss += st.loss; z.stations.push(st);
    }
    const mZones = [...zmap.values()].map(z => ({
      ...z, lossPct: ratio(z.loss, z.output), stations: z.stations.sort(byName),
    })).sort(byKcn);
    const loss = stations.reduce((s, r) => s + r.loss, 0);
    const output = stations.reduce((s, r) => s + r.output, 0);
    const capacity = stations.reduce((s, r) => s + r.sdm, 0);
    return { mZones, mKpi: { loss, output, capacity, pct: ratio(loss, output), n: stations.length } };
  }, [monthly, selMonth, metaByCode]);

  /* ---- Chuỗi theo NGÀY cho từng trạm (biểu đồ tháng) — lấy từ file NGÀY (chính xác) ---- */
  const dailySeriesByCode = useMemo(() => {
    const out = new Map<string, { label: string; lossPct: number; load: number; _d: string }[]>();
    for (const r of daily) {
      let arr = out.get(r.code);
      if (!arr) { arr = []; out.set(r.code, arr); }
      arr.push({ label: dateVN(r.date).slice(0, 5), lossPct: r.lossPct, load: r.avgLoadPct, _d: r.date });
    }
    const res = new Map<string, { label: string; lossPct: number; load: number }[]>();
    out.forEach((arr, code) => {
      res.set(code, arr.sort((a, b) => a._d.localeCompare(b._d)).map(({ _d, ...rest }) => rest));
    });
    return res;
  }, [daily]);

  /* Mặc định 3 cặp = 3 trạm %TT THẤP nhất; đổi được từng cặp. Reset khi đổi ngày. */
  const defaultPairs = useMemo(() => {
    const p = stationsSorted.slice(0, 3).map(s => s.code);
    while (p.length < 3) p.push('');
    return p.slice(0, 3);
  }, [stationsSorted]);
  const [pairPicks, setPairPicks] = useState<string[]>([]);
  useEffect(() => { setPairPicks(defaultPairs); }, [defaultPairs]);
  const stationOptions = useMemo(() => allStations.map(s => ({ value: s.code, label: s.name })), [allStations]);

  const hasData = daily.length > 0 || monthly.length > 0;
  const toggleZone = (k: string) => setCollapsed(c => ({ ...c, [k]: !c[k] }));

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Header */}
      <div className="vl-card p-6 md:p-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 bg-accent-soft rounded-2xl text-accent"><TrendingDown className="w-6 h-6" /></div>
          <h1 className="text-2xl font-black text-ink tracking-tight uppercase">Tổn thất tính toán máy biến áp</h1>
        </div>
        <p className="text-sm text-soft max-w-3xl flex items-start gap-1.5">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
          Tổn thất kỹ thuật ΔP = P0 + Pk·(S/Sdm)² theo từng trạm, gom theo khu công nghiệp. Tỷ lệ tổn thất (%) = tổn thất / điện nhận (sản lượng + tổn thất). Cảnh báo khi tỷ lệ tổn thất tổng khu công nghiệp vượt {fmt(ZONE_WARN_PCT, 1)}%.
        </p>
      </div>

      {/* Thanh tab đồng bộ + bộ chọn theo ngữ cảnh */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs<View> tabs={TABS} value={view} onChange={setView} />
        <div className="ml-auto">
          {view === 'monthly' ? (
            <Select value={selMonth} onChange={setSelMonth} className="min-w-[170px]"
              options={months.map(m => ({ value: m, label: monthVN(m) }))} />
          ) : (
            <DatePicker value={selDate} onChange={setSelDate} label="Ngày" className="w-[190px]" />
          )}
        </div>
      </div>

      {loading ? (
        <div className="vl-card"><EmptyState icon={Gauge} title="Đang tải dữ liệu tổn thất…" /></div>
      ) : !hasData ? (
        <div className="vl-card"><EmptyState icon={Zap} title="Chưa có dữ liệu tổn thất"
          hint="Cần nhập thông số MBA vào public/mba_info.csv và chờ pipeline chạy (00:00 hằng ngày)." /></div>
      ) : view === 'chart' ? (
        /* ---------- BIỂU ĐỒ ---------- */
        <>
          <KpiRow kpi={kpi} label={`ngày ${dateVN(selDate)}`} />
          {allStations.length === 0 ? (
            <div className="vl-card"><EmptyState icon={BarChart3} title="Không đủ dữ liệu vẽ biểu đồ" /></div>
          ) : (
            <div className="space-y-4">
              {pairPicks.map((code, i) => {
                const st = stationByCode.get(code);
                const daySlots = slotsByCode.get(code) || [];
                const monthSeries = dailySeriesByCode.get(code) || [];
                return (
                  <div key={i} className="vl-card p-4 md:p-5 space-y-3">
                    {/* Bộ chọn trạm dùng chung cho cả cặp */}
                    <div className="flex flex-wrap items-center gap-3">
                      <Select value={code} onChange={v => setPairPicks(p => p.map((x, idx) => (idx === i ? v : x)))}
                        searchable icon={Gauge} className="min-w-[240px]" placeholder="Chọn trạm…" options={stationOptions} />
                      {st && (
                        <span className="inline-flex items-center gap-2 text-[12px] text-soft">
                          % tổn thất <LossPctBadge v={st.lossPct} /> · mức tải đỉnh <strong style={{ color: loadColor(st.maxLoad) }}>{fmt(st.maxLoad, 0)}%</strong>
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <div className="text-[11px] font-bold text-faint uppercase tracking-wider mb-1">Trong ngày · {dateVN(selDate)}</div>
                        <div className="h-[220px]">
                          {daySlots.length ? <LossLoadChart data={daySlots} xKey="time" /> : <div className="h-full flex items-center justify-center text-faint text-xs">Không có dữ liệu ngày này</div>}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-faint uppercase tracking-wider mb-1">Theo tháng · {monthSeries.length} ngày</div>
                        <div className="h-[220px]">
                          {monthSeries.length ? <LossLoadChart data={monthSeries} xKey="label" /> : <div className="h-full flex items-center justify-center text-faint text-xs">Không có dữ liệu tháng</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-faint flex items-center gap-3 px-1">
                <span className="inline-flex items-center gap-1"><span className="w-4 h-[3px] rounded" style={{ background: CHART.cd }} /> Mức tải (%)</span>
                <span className="inline-flex items-center gap-1"><span className="w-4 h-[3px] rounded" style={{ background: CHART.vc }} /> Tỷ lệ tổn thất (%)</span>
              </p>
            </div>
          )}
        </>
      ) : view === 'monthly' ? (
        /* ---------- THEO THÁNG ---------- */
        <>
          <KpiRow kpi={mKpi} label={monthVN(selMonth)} />
          {mZones.length === 0 ? (
            <div className="vl-card"><EmptyState icon={CalendarRange} title="Không có dữ liệu tháng này" /></div>
          ) : (
            <div className="space-y-4">
              {mZones.map(z => (
                <ZoneCard key={z.kcn} kcn={z.kcn} count={z.stations.length} capacity={z.capacity} loss={z.loss} lossPct={z.lossPct}
                  collapsed={!!collapsed['m:' + z.kcn]} onToggle={() => toggleZone('m:' + z.kcn)}>
                  <table className="w-full text-left border-collapse min-w-[820px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                        <th className="py-3 px-4">Trạm</th>
                        <th className="py-3 px-4 text-right">Công suất đặt (kVA)</th>
                        <th className="py-3 px-4 text-right">Sản lượng (kWh)</th>
                        <th className="py-3 px-4 text-right">Tổn thất (kWh)</th>
                        <th className="py-3 px-4 text-right">Tỷ lệ tổn thất (%)</th>
                        <th className="py-3 px-4 text-right">Không tải</th>
                        <th className="py-3 px-4 text-right">Có tải</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {z.stations.map(st => (
                        <tr key={st.code} className={`hover:bg-subtle transition-colors ${st.active ? '' : 'opacity-60'}`}>
                          <td className="py-3 px-4">
                            <div className="text-sm font-semibold text-ink break-words flex items-center gap-2">
                              {st.name}
                              {!st.active && <span className="text-[10px] font-bold text-faint uppercase px-1.5 py-0.5 rounded bg-subtle">Không vận hành</span>}
                            </div>
                            <div className="text-[11px] text-faint font-mono">{st.code}</div>
                          </td>
                          <td className="py-3 px-4 text-right text-sm text-dim tabular-nums">{fmt(st.sdm, 0)}</td>
                          {st.active ? (
                            <>
                              <td className="py-3 px-4 text-right text-sm text-dim tabular-nums">{fmt(st.output)}</td>
                              <td className="py-3 px-4 text-right text-sm font-bold text-ink tabular-nums">{fmt(st.loss)}</td>
                              <td className="py-3 px-4 text-right"><LossPctBadge v={st.lossPct} /></td>
                              <td className="py-3 px-4 text-right text-sm text-soft tabular-nums">{fmt(st.noload)}</td>
                              <td className="py-3 px-4 text-right text-sm text-soft tabular-nums">{fmt(st.load)}</td>
                            </>
                          ) : (
                            <td className="py-3 px-4 text-center text-faint text-xs" colSpan={5}>Không có dữ liệu trong tháng</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface border-t-2 border-[var(--border-strong)] text-sm font-black text-ink">
                        <td className="py-3 px-4 text-right uppercase text-xs tracking-wider text-dim">Tổng cộng</td>
                        <td className="py-3 px-4 text-right tabular-nums">{fmt(z.capacity, 0)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{fmt(z.output)}</td>
                        <td className="py-3 px-4 text-right tabular-nums text-accent">{fmt(z.loss)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{pct(z.lossPct)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </ZoneCard>
              ))}
            </div>
          )}
        </>
      ) : (
        /* ---------- THEO TRẠM (NGÀY) ---------- */
        <>
          <KpiRow kpi={kpi} label={`ngày ${dateVN(selDate)}`} />
          {zones.length === 0 ? (
            <div className="vl-card"><EmptyState icon={TrendingDown} title="Không có dữ liệu ngày này" /></div>
          ) : (
            <div className="space-y-4">
              {zones.map(z => (
                <ZoneCard key={z.kcn} kcn={z.kcn} count={z.stations.length} capacity={z.capacity} loss={z.loss} lossPct={z.lossPct}
                  collapsed={!!collapsed['d:' + z.kcn]} onToggle={() => toggleZone('d:' + z.kcn)}>
                  <table className="w-full text-left border-collapse min-w-[920px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                        <th className="py-3 px-4">Trạm</th>
                        <th className="py-3 px-4 text-right">Công suất đặt (kVA)</th>
                        <th className="py-3 px-4 text-right">Sản lượng (kWh)</th>
                        <th className="py-3 px-4 text-right">Tổn thất (kWh)</th>
                        <th className="py-3 px-4 text-right">Tỷ lệ tổn thất (%)</th>
                        <th className="py-3 px-4 text-center">Δ hôm qua</th>
                        <th className="py-3 px-4">Mức đầy tải (đỉnh)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {z.stations.map(st => (
                        <tr key={st.code} className={`hover:bg-subtle transition-colors ${st.active ? '' : 'opacity-60'}`}>
                          <td className="py-3 px-4">
                            <div className="text-sm font-semibold text-ink break-words flex items-center gap-2">
                              {st.name}
                              {!st.active && <span className="text-[10px] font-bold text-faint uppercase px-1.5 py-0.5 rounded bg-subtle">Không vận hành</span>}
                            </div>
                            <div className="text-[11px] text-faint font-mono">{st.code}</div>
                          </td>
                          <td className="py-3 px-4 text-right text-sm text-dim tabular-nums">{fmt(st.sdm, 0)}</td>
                          {st.active ? (
                            <>
                              <td className="py-3 px-4 text-right text-sm text-dim tabular-nums">{fmt(st.output)}</td>
                              <td className="py-3 px-4 text-right text-sm font-bold text-ink tabular-nums">{fmt(st.loss)}</td>
                              <td className="py-3 px-4 text-right"><LossPctBadge v={st.lossPct} /></td>
                              <td className="py-3 px-4 text-center"><LossDelta d={st.delta} /></td>
                              <td className="py-3 px-4"><LoadBar value={st.maxLoad} /></td>
                            </>
                          ) : (
                            <td className="py-3 px-4 text-center text-faint text-xs" colSpan={4}>Không có dữ liệu ngày này</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface border-t-2 border-[var(--border-strong)] text-sm font-black text-ink">
                        <td className="py-3 px-4 text-right uppercase text-xs tracking-wider text-dim">Tổng cộng</td>
                        <td className="py-3 px-4 text-right tabular-nums">{fmt(z.capacity, 0)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{fmt(z.output)}</td>
                        <td className="py-3 px-4 text-right tabular-nums text-accent">{fmt(z.loss)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{pct(z.lossPct)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </ZoneCard>
              ))}
            </div>
          )}
        </>
      )}

      {/* Chú thích phương pháp tính */}
      {!loading && (
        <div className="vl-card p-5 text-xs text-soft space-y-4 leading-relaxed">
          <div className="flex items-center gap-2 font-bold text-dim uppercase text-[11px] tracking-wider">
            <Info className="w-4 h-4 text-amber-500" /> Phương pháp tính tổn thất máy biến áp
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-ink">Ký hiệu chung</p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><strong>P0</strong> — tổn thất không tải (công suất, kW), tra từ mba_info.csv (đơn vị gốc W ÷ 1000).</li>
              <li><strong>Pk</strong> — tổn thất ngắn mạch / có tải định mức (kW).</li>
              <li><strong>Sdm</strong> — công suất đặt (định mức) của MBA (kVA); <strong>Idm</strong> — dòng định mức tương ứng.</li>
              <li><strong>S</strong> = √(P² + Q²) — công suất biểu kiến tức thời (kVA), với P, Q là công suất tác dụng/phản kháng đo được.</li>
              <li><strong>T</strong> — thời gian MBA mang điện; <strong>τ</strong> — thời gian tổn thất công suất lớn nhất; <strong>Δt</strong> — khoảng thời gian thực giữa hai bản ghi liên tiếp.</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-ink">Cách 1 — Trực tiếp theo đồ thị phụ tải (đang áp dụng)</p>
            <p>Tại mỗi mốc đo lấy S = √(P²+Q²), tính tổn thất công suất tức thời rồi tích phân (cộng dồn) theo thời gian thực:</p>
            <div className="rounded-lg bg-subtle px-3 py-2 font-mono text-[12px] text-ink space-y-1">
              <div>ΔP(t) = P0 + Pk · (S(t) / Sdm)²&nbsp;&nbsp;[kW]</div>
              <div>ΔA = Σ ΔP(tᵢ) · Δtᵢ = P0·T + Pk · Σ (S(tᵢ)/Sdm)² · Δtᵢ&nbsp;&nbsp;[kWh]</div>
            </div>
            <p>Trong ứng dụng: bước 30 phút, Δt lấy đúng khoảng cách thực giữa hai bản ghi, chỉ tính khi điện áp pha &gt; 0 (MBA mang điện). P0 cộng cho toàn bộ thời gian mang điện; thành phần có tải biến thiên theo S².</p>
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-ink">Cách 2 — Dòng cực đại I_max &amp; thời gian tổn thất τ</p>
            <p>Dùng dòng điện đỉnh I_max và thời gian tổn thất τ (suy từ hệ số điền kín/hình dạng đồ thị phụ tải) để quy đổi thành phần có tải:</p>
            <div className="rounded-lg bg-subtle px-3 py-2 font-mono text-[12px] text-ink space-y-1">
              <div>ΔA = P0 · T + Pk · (I_max / Idm)² · τ&nbsp;&nbsp;[kWh]</div>
              <div>τ = (0,124 + T_max · 10⁻⁴)² · 8760&nbsp;&nbsp;[h/năm]</div>
            </div>
            <p>Với T_max là thời gian sử dụng công suất lớn nhất. Áp dụng khi chỉ có dòng đỉnh và thông số vận hành tổng hợp thay cho đồ thị phụ tải chi tiết.</p>
          </div>

          <p className="text-faint">Tỷ lệ tổn thất (%) = tổn thất ÷ điện nhận = tổn thất ÷ (sản lượng giao + tổn thất). Cảnh báo khi tỷ lệ tổn thất tổng của khu công nghiệp vượt {fmt(ZONE_WARN_PCT, 1)}%.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Trục % tổn thất động: chọn bước "đẹp" (1/2/5 ×10ⁿ) nhưng KHÔNG nhỏ hơn 0,01%.
 * Trả về [domain, ticks] để các mốc luôn là bội của bước → đọc được chênh lệch tới 0,01%.
 */
function pctAxis(lo: number, hi: number): { domain: [number, number]; ticks: number[] } {
  const MIN_STEP = 0.01;
  let span = hi - lo;
  if (span <= 0) span = Math.max(hi, MIN_STEP);
  const raw = span / 4;                         // nhắm ~4–5 mốc
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = Math.max(MIN_STEP, nice * mag);
  const start = Math.max(0, Math.floor(lo / step) * step);
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / MIN_STEP) * MIN_STEP);
  return { domain: [start, end], ticks };
}

/* Biểu đồ đường: Mức tải (%) + Tỷ lệ tổn thất (%). Trục tải trái 0–100; trục %TT phải tự co giãn. */
function LossLoadChart({ data, xKey }: { data: { lossPct: number; load: number }[]; xKey: string }) {
  const pv = data.map(d => d.lossPct);
  const lo = pv.length ? Math.min(...pv) : 0;
  const hi = pv.length ? Math.max(...pv) : 1;
  const pad = (hi - lo) * 0.15 || Math.max(hi * 0.1, 0.01);
  const { domain, ticks } = pctAxis(Math.max(0, lo - pad), hi + pad);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
        <XAxis dataKey={xKey} tickLine={false} stroke="var(--text-4)" style={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={20} />
        <YAxis yAxisId="load" domain={[0, 100]} width={28} tickLine={false} axisLine={false} stroke={CHART.cd} style={{ fontSize: 9 }} />
        <YAxis yAxisId="pct" orientation="right" domain={domain} ticks={ticks} allowDecimals width={52} tickLine={false} axisLine={false} stroke={CHART.vc} style={{ fontSize: 9 }} tickFormatter={(v: number) => `${fmt(v, 2)}%`} />
        <Tooltip content={<ChartTooltip fmt={(v, n) => (n === 'Mức tải' ? `${fmt(v, 1)}%` : `${fmt(v, 2)}%`)} />} />
        <Line yAxisId="load" type="monotone" dataKey="load" name="Mức tải" stroke={CHART.cd} strokeWidth={2} dot={false} />
        <Line yAxisId="pct" type="monotone" dataKey="lossPct" name="Tỷ lệ tổn thất" stroke={CHART.vc} strokeWidth={2.4} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* KPI dùng chung cho các tab. */
function KpiRow({ kpi, label }: { kpi: { loss: number; output: number; capacity: number; pct: number; n: number }; label: string }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatTile label="Tổng tổn thất" value={fmt(kpi.loss)} unit="kWh" icon={TrendingDown} tone="bad" sub={`${kpi.n} trạm · ${label}`} />
      <StatTile label="Tổng sản lượng" value={fmt(kpi.output)} unit="kWh" icon={Zap} tone="accent" />
      <StatTile label="Tổng công suất đặt" value={fmt(kpi.capacity, 0)} unit="kVA" icon={Building2} tone="accent" />
      <StatTile label="Tỷ lệ tổn thất tổng" value={pct(kpi.pct)} icon={Gauge} tone={kpi.pct > ZONE_WARN_PCT ? 'bad' : kpi.pct >= 1 ? 'warn' : 'ok'} />
    </div>
  );
}
