import { useEffect, useMemo, useState, ReactNode } from 'react';
import {
  ResponsiveContainer, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Bar, Line, Cell,
} from 'recharts';
import {
  TrendingDown, Info, CalendarDays, CalendarRange, BarChart3, Building2, Zap, Gauge,
  ChevronDown, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import { toast as notify } from '../lib/toast';
import { StatTile, EmptyState, ChartTooltip, CHART } from './ui/dashboard';
import { Tabs, TabItem } from './ui/Tabs';
import { Select } from './ui/Select';
import { DatePicker } from './ui/DateTimePickers';
import { fetchLoss30min, fetchLossMonthly, Loss30minRow, LossMonthlyRow } from '../lib/transformerLoss';
import { fetchMeterInfo, MeterInfoRow } from '../lib/meterInfo';

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

/** Màu theo mức đầy tải: đỏ ≤10% hoặc ≥90%; vàng 10–30% & 80–90%; xanh 30–80%. */
function loadColor(p: number): string {
  if (p <= 10 || p >= 90) return 'var(--danger)';
  if (p < 30 || p > 80) return 'var(--warning)';
  return 'var(--success)';
}
const lossPctColor = (p: number) => (p >= 5 ? 'var(--danger)' : p >= 2 ? 'var(--warning)' : 'var(--success)');

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
function ZoneCard({ kcn, count, loss, lossPct, collapsed, onToggle, children }: {
  kcn: string; count: number; loss: number; lossPct: number;
  collapsed: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className="vl-card overflow-hidden">
      <div onClick={onToggle}
        className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] px-5 md:px-7 py-4 flex items-center justify-between gap-3 cursor-pointer select-none">
        <div className="flex items-center gap-3 text-white min-w-0">
          <div className="p-2 bg-white/20 rounded-xl shrink-0"><Building2 className="w-5 h-5" /></div>
          <div className="min-w-0">
            <h3 className="text-base font-black tracking-tight leading-tight truncate">{kcn}</h3>
            <p className="text-[11px] font-semibold text-white/80">{count} trạm</p>
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
  code: string; name: string; kcn: string;
  output: number; loss: number; lossPct: number; maxLoad: number; delta: number | null; slots: Slot[];
}
interface ZoneDay { kcn: string; output: number; loss: number; lossPct: number; stations: StationDay[]; }
interface StationMonth { code: string; name: string; kcn: string; output: number; loss: number; noload: number; load: number; lossPct: number; }
interface ZoneMonth { kcn: string; output: number; loss: number; lossPct: number; stations: StationMonth[]; }

function dailyByStation(rows: Loss30minRow[], date: string) {
  const m = new Map<string, { output: number; loss: number; maxLoad: number; name: string; slots: Slot[] }>();
  for (const r of rows) {
    if (r.date !== date) continue;
    let s = m.get(r.code);
    if (!s) { s = { output: 0, loss: 0, maxLoad: 0, name: r.lineName || r.code, slots: [] }; m.set(r.code, s); }
    s.output += r.outputKwh;
    s.loss += r.lossKwh;
    if (r.loadPct > s.maxLoad) s.maxLoad = r.loadPct;
    s.slots.push({ time: r.time, loss: r.lossKwh, load: r.loadPct, p: r.p, output: r.outputKwh, lossPct: ratio(r.lossKwh, r.outputKwh) });
  }
  m.forEach(s => s.slots.sort((a, b) => a.time.localeCompare(b.time)));
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
  const [monthly, setMonthly] = useState<LossMonthlyRow[]>([]);
  const [meters, setMeters] = useState<MeterInfoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('table');
  const [selDate, setSelDate] = useState('');
  const [selMonth, setSelMonth] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let ok = true;
    setLoading(true);
    Promise.all([fetchLoss30min(), fetchLossMonthly(), fetchMeterInfo().catch(() => [] as MeterInfoRow[])])
      .then(([r, mo, mi]) => { if (ok) { setRows(r); setMonthly(mo); setMeters(mi); } })
      .catch(e => { console.error(e); notify.error('Lỗi dữ liệu', e?.message || 'Không tải được tổn thất MBA.'); })
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, []);

  const codeToKcn = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of meters) {
      if ((m.ROLE || '').trim() !== 'chinh') continue;
      const code = (m.CODE || '').trim();
      if (code && !map.has(code)) map.set(code, (m.ADDRESS || '').trim() || 'Khác');
    }
    return map;
  }, [meters]);

  const dates = useMemo(() => [...new Set(rows.map(r => r.date))].sort().reverse(), [rows]);
  useEffect(() => {
    if (dates.length) setSelDate(p => p || (dates.includes(yesterdayKey()) ? yesterdayKey() : dates[0]));
  }, [dates]);
  const months = useMemo(() => [...new Set(monthly.map(r => r.month))].sort().reverse(), [monthly]);
  useEffect(() => { if (months.length) setSelMonth(p => p || months[0]); }, [months]);

  /* ---- Gom theo NGÀY (bảng ngày + biểu đồ) — sắp theo TÊN TRẠM ---- */
  const { zones, kpi, stationsSorted, stationByCode, allStations } = useMemo(() => {
    const empty = {
      zones: [] as ZoneDay[], kpi: { loss: 0, output: 0, pct: 0, n: 0 },
      stationsSorted: [] as StationDay[], stationByCode: new Map<string, StationDay>(), allStations: [] as StationDay[],
    };
    if (!selDate) return empty;
    const cur = dailyByStation(rows, selDate);
    const prev = dailyByStation(rows, prevDay(selDate));
    const stations: StationDay[] = [];
    cur.forEach((s, code) => {
      const prevLoss = prev.get(code)?.loss;
      stations.push({
        code, name: s.name, kcn: codeToKcn.get(code) || 'Khác',
        output: s.output, loss: s.loss, lossPct: ratio(s.loss, s.output),
        maxLoad: s.maxLoad, delta: prevLoss != null && prevLoss > 0 ? (s.loss - prevLoss) / prevLoss : null,
        slots: s.slots,
      });
    });
    const zmap = new Map<string, ZoneDay>();
    for (const st of stations) {
      let z = zmap.get(st.kcn);
      if (!z) { z = { kcn: st.kcn, output: 0, loss: 0, lossPct: 0, stations: [] }; zmap.set(st.kcn, z); }
      z.output += st.output; z.loss += st.loss; z.stations.push(st);
    }
    const zones = [...zmap.values()].map(z => ({
      ...z, lossPct: ratio(z.loss, z.output), stations: z.stations.sort(byName),
    })).sort(byKcn);
    const loss = stations.reduce((s, x) => s + x.loss, 0);
    const output = stations.reduce((s, x) => s + x.output, 0);
    return {
      zones, kpi: { loss, output, pct: ratio(loss, output), n: stations.length },
      stationsSorted: [...stations].filter(s => s.output + s.loss > 0).sort((a, b) => a.lossPct - b.lossPct),
      stationByCode: new Map(stations.map(s => [s.code, s])),
      allStations: [...stations].sort(byName),
    };
  }, [rows, selDate, codeToKcn]);

  /* ---- Gom theo THÁNG — sắp theo TÊN TRẠM ---- */
  const { mZones, mKpi } = useMemo(() => {
    const rowsM = monthly.filter(r => r.month === selMonth);
    const zmap = new Map<string, ZoneMonth>();
    for (const r of rowsM) {
      const kcn = codeToKcn.get(r.code) || 'Khác';
      let z = zmap.get(kcn);
      if (!z) { z = { kcn, output: 0, loss: 0, lossPct: 0, stations: [] }; zmap.set(kcn, z); }
      z.output += r.outputKwh; z.loss += r.totalKwh;
      z.stations.push({
        code: r.code, name: r.lineName || r.code, kcn,
        output: r.outputKwh, loss: r.totalKwh, noload: r.noloadKwh, load: r.loadKwh,
        lossPct: ratio(r.totalKwh, r.outputKwh),
      });
    }
    const mZones = [...zmap.values()].map(z => ({
      ...z, lossPct: ratio(z.loss, z.output), stations: z.stations.sort(byName),
    })).sort(byKcn);
    const loss = rowsM.reduce((s, r) => s + r.totalKwh, 0);
    const output = rowsM.reduce((s, r) => s + r.outputKwh, 0);
    return { mZones, mKpi: { loss, output, pct: ratio(loss, output), n: rowsM.length } };
  }, [monthly, selMonth, codeToKcn]);

  /* ---- 6 biểu đồ: 3 %TT thấp + 3 cao ---- */
  const chartStations = useMemo(() => {
    const lo = stationsSorted.slice(0, 3);
    const hi = stationsSorted.slice(-3).reverse();
    const seen = new Set<string>();
    const pick: { st: StationDay; kind: 'low' | 'high' }[] = [];
    [...lo.map(st => ['low', st] as const), ...hi.map(st => ['high', st] as const)]
      .forEach(([kind, st]) => { if (!seen.has(st.code)) { seen.add(st.code); pick.push({ st, kind }); } });
    return pick;
  }, [stationsSorted]);

  /* Mặc định 6 ô = 3 %TT thấp + 3 cao; cho phép đổi trạm từng ô. Reset khi đổi ngày. */
  const defaultPicks = useMemo(() => {
    const p = chartStations.map(c => c.st.code);
    while (p.length < 6) p.push('');
    return p.slice(0, 6);
  }, [chartStations]);
  const [chartPicks, setChartPicks] = useState<string[]>([]);
  useEffect(() => { setChartPicks(defaultPicks); }, [defaultPicks]);
  const stationOptions = useMemo(() => allStations.map(s => ({ value: s.code, label: s.name })), [allStations]);

  const hasData = rows.length > 0 || monthly.length > 0;
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
          Tổn thất kỹ thuật ΔP = P0 + Pk·(S/Sdm)² theo từng trạm, gom theo khu công nghiệp. % tổn thất = tổn thất / điện nhận (sản lượng + tổn thất).
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {chartPicks.map((code, i) => {
                const st = stationByCode.get(code);
                // Trục % tự co giãn quanh khoảng dữ liệu (để 0,3–0,4% vẫn nhìn rõ)
                const pv = st ? st.slots.map(s => s.lossPct) : [];
                const lo = pv.length ? Math.min(...pv) : 0;
                const hi = pv.length ? Math.max(...pv) : 1;
                const pad = (hi - lo) * 0.25 || Math.max(hi * 0.1, 0.05);
                const pctDomain: [number, number] = [Math.max(0, lo - pad), hi + pad];
                return (
                  <div key={i} className="vl-card p-4 flex flex-col gap-3 min-h-[340px]">
                    <Select value={code} onChange={v => setChartPicks(p => p.map((x, idx) => (idx === i ? v : x)))}
                      searchable icon={Gauge} className="w-full" placeholder="Chọn trạm…" options={stationOptions} />
                    {st ? (
                      <>
                        <div className="text-[11px] font-mono text-faint">
                          % tổn thất <strong style={{ color: lossPctColor(st.lossPct) }}>{pct(st.lossPct)}</strong> · sản lượng {fmt(st.output)} kWh
                        </div>
                        <div className="h-[240px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={st.slots} margin={{ top: 8, right: 4, left: 4, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                              <XAxis dataKey="time" tickLine={false} stroke="var(--text-4)" style={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={22} />
                              <YAxis yAxisId="l" hide />
                              <YAxis yAxisId="pct" orientation="right" domain={pctDomain} width={44}
                                tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 9 }}
                                tickFormatter={(v: number) => `${fmt(v, 2)}%`} />
                              <Tooltip content={<ChartTooltip fmt={(v, n) => (n === '% tổn thất' ? `${fmt(v, 2)}%` : `${fmt(v, 3)} kWh`)} />} />
                              <Bar yAxisId="l" dataKey="loss" name="Tổn thất" radius={[2, 2, 0, 0]} maxBarSize={10} fillOpacity={0.32}>
                                {st.slots.map((s, idx) => <Cell key={idx} fill={loadColor(s.load)} />)}
                              </Bar>
                              <Line yAxisId="pct" type="monotone" dataKey="lossPct" name="% tổn thất" stroke={CHART.vc} strokeWidth={2.4} dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    ) : (
                      <div className="h-[240px] flex items-center justify-center text-faint text-sm">Chọn trạm để xem biểu đồ</div>
                    )}
                  </div>
                );
              })}
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
                <ZoneCard key={z.kcn} kcn={z.kcn} count={z.stations.length} loss={z.loss} lossPct={z.lossPct}
                  collapsed={!!collapsed['m:' + z.kcn]} onToggle={() => toggleZone('m:' + z.kcn)}>
                  <table className="w-full text-left border-collapse min-w-[720px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                        <th className="py-3 px-4">Trạm</th>
                        <th className="py-3 px-4 text-right">Sản lượng (kWh)</th>
                        <th className="py-3 px-4 text-right">Tổn thất (kWh)</th>
                        <th className="py-3 px-4 text-right">% TT</th>
                        <th className="py-3 px-4 text-right">Không tải</th>
                        <th className="py-3 px-4 text-right">Có tải</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {z.stations.map(st => (
                        <tr key={st.code} className="hover:bg-subtle transition-colors">
                          <td className="py-3 px-4">
                            <div className="text-sm font-semibold text-ink break-words">{st.name}</div>
                            <div className="text-[11px] text-faint font-mono">{st.code}</div>
                          </td>
                          <td className="py-3 px-4 text-right text-sm text-dim tabular-nums">{fmt(st.output)}</td>
                          <td className="py-3 px-4 text-right text-sm font-bold text-ink tabular-nums">{fmt(st.loss)}</td>
                          <td className="py-3 px-4 text-right text-sm font-semibold tabular-nums" style={{ color: lossPctColor(st.lossPct) }}>{pct(st.lossPct)}</td>
                          <td className="py-3 px-4 text-right text-sm text-soft tabular-nums">{fmt(st.noload)}</td>
                          <td className="py-3 px-4 text-right text-sm text-soft tabular-nums">{fmt(st.load)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface border-t-2 border-[var(--border-strong)] text-sm font-black text-ink">
                        <td className="py-3 px-4 text-right uppercase text-xs tracking-wider text-dim">Tổng cộng</td>
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
                <ZoneCard key={z.kcn} kcn={z.kcn} count={z.stations.length} loss={z.loss} lossPct={z.lossPct}
                  collapsed={!!collapsed['d:' + z.kcn]} onToggle={() => toggleZone('d:' + z.kcn)}>
                  <table className="w-full text-left border-collapse min-w-[820px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                        <th className="py-3 px-4">Trạm</th>
                        <th className="py-3 px-4 text-right">Sản lượng (kWh)</th>
                        <th className="py-3 px-4 text-right">Tổn thất (kWh)</th>
                        <th className="py-3 px-4 text-right">% TT</th>
                        <th className="py-3 px-4 text-center">Δ hôm qua</th>
                        <th className="py-3 px-4">Mức đầy tải (đỉnh)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {z.stations.map(st => (
                        <tr key={st.code} className="hover:bg-subtle transition-colors">
                          <td className="py-3 px-4">
                            <div className="text-sm font-semibold text-ink break-words">{st.name}</div>
                            <div className="text-[11px] text-faint font-mono">{st.code}</div>
                          </td>
                          <td className="py-3 px-4 text-right text-sm text-dim tabular-nums">{fmt(st.output)}</td>
                          <td className="py-3 px-4 text-right text-sm font-bold text-ink tabular-nums">{fmt(st.loss)}</td>
                          <td className="py-3 px-4 text-right text-sm font-semibold tabular-nums" style={{ color: lossPctColor(st.lossPct) }}>{pct(st.lossPct)}</td>
                          <td className="py-3 px-4 text-center"><LossDelta d={st.delta} /></td>
                          <td className="py-3 px-4"><LoadBar value={st.maxLoad} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface border-t-2 border-[var(--border-strong)] text-sm font-black text-ink">
                        <td className="py-3 px-4 text-right uppercase text-xs tracking-wider text-dim">Tổng cộng</td>
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
    </div>
  );
}

/* KPI 3 ô dùng chung cho các tab. */
function KpiRow({ kpi, label }: { kpi: { loss: number; output: number; pct: number; n: number }; label: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <StatTile label="Tổng tổn thất" value={fmt(kpi.loss)} unit="kWh" icon={TrendingDown} tone="bad" sub={`${kpi.n} trạm · ${label}`} />
      <StatTile label="Tổng sản lượng" value={fmt(kpi.output)} unit="kWh" icon={Zap} tone="accent" />
      <StatTile label="% tổn thất tổng" value={pct(kpi.pct)} icon={Gauge} tone={kpi.pct >= 5 ? 'bad' : kpi.pct >= 2 ? 'warn' : 'ok'} />
    </div>
  );
}
