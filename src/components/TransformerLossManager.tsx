import { useEffect, useMemo, useState, Fragment } from 'react';
import {
  ResponsiveContainer, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Bar, Line, Cell,
} from 'recharts';
import {
  TrendingDown, Info, CalendarDays, BarChart3, Building2, Zap, Gauge,
  ChevronDown, ChevronRight, ArrowUpRight, ArrowDownRight, Minus, TrendingUp,
} from 'lucide-react';
import { toast as notify } from '../lib/toast';
import { StatTile, Panel, EmptyState, ChartTooltip, CHART } from './ui/dashboard';
import { DatePicker } from './ui/DateTimePickers';
import { fetchLoss30min, Loss30minRow } from '../lib/transformerLoss';
import { fetchMeterInfo, MeterInfoRow } from '../lib/meterInfo';

/* ================= helpers ================= */
const fmt = (v: number, d = 1) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(v);
const pct = (v: number) => `${fmt(v, 1)}%`;
const dateVN = (k: string) => { const [y, m, d] = k.split('-'); return d ? `${d}/${m}/${y}` : k; };
const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const prevDay = (k: string) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };

/** Màu theo mức đầy tải: đỏ ≤10% hoặc ≥90%; vàng 10–30% & 80–90%; xanh 30–80%. */
function loadColor(p: number): string {
  if (p <= 10 || p >= 90) return 'var(--danger)';
  if (p < 30 || p > 80) return 'var(--warning)';
  return 'var(--success)';
}

/* Thanh mức đầy tải với 3 mốc màu. */
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

/* ================= types ================= */
interface Slot { time: string; loss: number; load: number; p: number; }
interface StationAgg {
  code: string; name: string; kcn: string;
  output: number;      // sản lượng kWh (Σ P·0.5)
  loss: number;        // tổn thất kWh
  lossPct: number;     // % tổn thất = loss/output
  maxLoad: number;     // mức đầy tải đỉnh (%)
  delta: number | null; // Δ tổn thất so với hôm qua
  slots: Slot[];
}
interface ZoneAgg { kcn: string; output: number; loss: number; lossPct: number; stations: StationAgg[]; }

/** Gom {code -> {output, loss, maxLoad, slots}} cho 1 ngày. */
function dailyByStation(rows: Loss30minRow[], date: string) {
  const m = new Map<string, { output: number; loss: number; maxLoad: number; name: string; slots: Slot[] }>();
  for (const r of rows) {
    if (r.date !== date) continue;
    let s = m.get(r.code);
    if (!s) { s = { output: 0, loss: 0, maxLoad: 0, name: r.lineName || r.code, slots: [] }; m.set(r.code, s); }
    s.output += r.outputKwh;
    s.loss += r.lossKwh;
    if (r.loadPct > s.maxLoad) s.maxLoad = r.loadPct;
    s.slots.push({ time: r.time, loss: r.lossKwh, load: r.loadPct, p: r.p });
  }
  m.forEach(s => s.slots.sort((a, b) => a.time.localeCompare(b.time)));
  return m;
}

/* ================= component ================= */
type View = 'table' | 'chart';

export default function TransformerLossManager() {
  const [rows, setRows] = useState<Loss30minRow[]>([]);
  const [meters, setMeters] = useState<MeterInfoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('table');
  const [selDate, setSelDate] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let ok = true;
    setLoading(true);
    Promise.all([fetchLoss30min(), fetchMeterInfo().catch(() => [] as MeterInfoRow[])])
      .then(([r, mi]) => { if (ok) { setRows(r); setMeters(mi); } })
      .catch(e => { console.error(e); notify.error('Lỗi dữ liệu', e?.message || 'Không tải được tổn thất MBA.'); })
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, []);

  /* code -> KCN (ADDRESS của công tơ chính) */
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
    if (!dates.length) return;
    const y = yesterdayKey();
    setSelDate(prev => prev || (dates.includes(y) ? y : dates[0]));
  }, [dates]);

  /* Gom theo trạm cho ngày chọn + Δ so với hôm trước */
  const { zones, kpi, stationsSorted } = useMemo(() => {
    const cur = dailyByStation(rows, selDate);
    const prev = dailyByStation(rows, prevDay(selDate));
    const stations: StationAgg[] = [];
    cur.forEach((s, code) => {
      const prevLoss = prev.get(code)?.loss;
      const lossPct = s.output > 0 ? (s.loss / s.output) * 100 : 0;
      stations.push({
        code, name: s.name, kcn: codeToKcn.get(code) || 'Khác',
        output: s.output, loss: s.loss, lossPct, maxLoad: s.maxLoad,
        delta: prevLoss != null && prevLoss > 0 ? (s.loss - prevLoss) / prevLoss : null,
        slots: s.slots,
      });
    });
    // gom theo KCN
    const zmap = new Map<string, ZoneAgg>();
    for (const st of stations) {
      let z = zmap.get(st.kcn);
      if (!z) { z = { kcn: st.kcn, output: 0, loss: 0, lossPct: 0, stations: [] }; zmap.set(st.kcn, z); }
      z.output += st.output; z.loss += st.loss; z.stations.push(st);
    }
    const zones = [...zmap.values()].map(z => ({
      ...z, lossPct: z.output > 0 ? (z.loss / z.output) * 100 : 0,
      stations: z.stations.sort((a, b) => b.loss - a.loss),
    })).sort((a, b) => b.loss - a.loss);
    const totLoss = stations.reduce((s, x) => s + x.loss, 0);
    const totOut = stations.reduce((s, x) => s + x.output, 0);
    return {
      zones,
      kpi: { loss: totLoss, output: totOut, pct: totOut > 0 ? (totLoss / totOut) * 100 : 0, n: stations.length },
      stationsSorted: [...stations].filter(s => s.output > 0).sort((a, b) => a.lossPct - b.lossPct),
    };
  }, [rows, selDate, codeToKcn]);

  /* 6 biểu đồ: 3 trạm %TT thấp nhất + 3 cao nhất */
  const chartStations = useMemo(() => {
    const lo = stationsSorted.slice(0, 3);
    const hi = stationsSorted.slice(-3).reverse();
    const seen = new Set<string>();
    const pick: { st: StationAgg; kind: 'low' | 'high' }[] = [];
    lo.forEach(st => { if (!seen.has(st.code)) { seen.add(st.code); pick.push({ st, kind: 'low' }); } });
    hi.forEach(st => { if (!seen.has(st.code)) { seen.add(st.code); pick.push({ st, kind: 'high' }); } });
    return pick;
  }, [stationsSorted]);

  const hasData = rows.length > 0;

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
          Tổn thất kỹ thuật ΔP = P0 + Pk·(S/Sdm)² theo từng trạm, gom theo khu công nghiệp. % tổn thất = tổn thất / sản lượng.
        </p>
      </div>

      {/* Tab ngang + datepicker */}
      <div className="flex flex-wrap items-center gap-2">
        {([['table', 'Bảng theo trạm', CalendarDays], ['chart', 'Biểu đồ', BarChart3]] as const).map(([v, label, Icon]) => (
          <button key={v} onClick={() => setView(v)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              view === v ? 'bg-accent text-[var(--on-accent)]' : 'bg-subtle text-dim hover:bg-[var(--surface-inset)]'}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
        <div className="ml-auto">
          <DatePicker value={selDate} onChange={setSelDate} label="Ngày" className="w-[190px]" />
        </div>
      </div>

      {loading ? (
        <div className="vl-card"><EmptyState icon={Gauge} title="Đang tải dữ liệu tổn thất…" /></div>
      ) : !hasData ? (
        <div className="vl-card"><EmptyState icon={Zap} title="Chưa có dữ liệu tổn thất"
          hint="Cần nhập thông số MBA vào public/mba_info.csv và chờ pipeline chạy (00:00 hằng ngày)." /></div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatTile label="Tổng tổn thất" value={fmt(kpi.loss)} unit="kWh" icon={TrendingDown} tone="bad"
              sub={`${kpi.n} trạm · ngày ${dateVN(selDate)}`} />
            <StatTile label="Tổng sản lượng" value={fmt(kpi.output)} unit="kWh" icon={Zap} tone="accent" />
            <StatTile label="% tổn thất tổng" value={pct(kpi.pct)} icon={Gauge}
              tone={kpi.pct >= 5 ? 'bad' : kpi.pct >= 2 ? 'warn' : 'ok'} />
          </div>

          {view === 'table' ? (
            zones.length === 0 ? (
              <div className="vl-card"><EmptyState icon={TrendingDown} title="Không có dữ liệu ngày này" /></div>
            ) : (
              <div className="space-y-4">
                {zones.map(z => {
                  const isCollapsed = !!collapsed[z.kcn];
                  return (
                    <div key={z.kcn} className="vl-card overflow-hidden">
                      {/* Header KCN */}
                      <div onClick={() => setCollapsed(c => ({ ...c, [z.kcn]: !c[z.kcn] }))}
                        className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] px-5 md:px-7 py-4 flex items-center justify-between gap-3 cursor-pointer select-none">
                        <div className="flex items-center gap-3 text-white min-w-0">
                          <div className="p-2 bg-white/20 rounded-xl shrink-0"><Building2 className="w-5 h-5" /></div>
                          <div className="min-w-0">
                            <h3 className="text-base font-black tracking-tight leading-tight truncate">{z.kcn}</h3>
                            <p className="text-[11px] font-semibold text-white/80">{z.stations.length} trạm</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right hidden sm:block leading-tight">
                            <div className="text-xs font-bold text-white tabular-nums">{fmt(z.loss)} <span className="font-normal text-white/70">kWh</span></div>
                            <div className="text-xs font-bold text-white tabular-nums">{pct(z.lossPct)} <span className="font-normal text-white/70">tổn thất</span></div>
                          </div>
                          <ChevronDown className={`w-5 h-5 text-white transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} />
                        </div>
                      </div>

                      {!isCollapsed && (
                        <div className="overflow-x-auto">
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
                              {z.stations.map(st => {
                                const open = !!openRows[st.code];
                                return (
                                  <Fragment key={st.code}>
                                    <tr onClick={() => setOpenRows(o => ({ ...o, [st.code]: !o[st.code] }))}
                                      className={`cursor-pointer transition-colors ${open ? 'bg-accent-soft/50' : 'hover:bg-subtle'}`}>
                                      <td className="py-3 px-4">
                                        <div className="flex items-start gap-2">
                                          <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 transition-transform ${open ? 'rotate-90 text-accent' : 'text-faint'}`} />
                                          <div className="min-w-0">
                                            <div className="text-sm font-semibold text-ink break-words">{st.name}</div>
                                            <div className="text-[11px] text-faint font-mono">{st.code}</div>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="py-3 px-4 text-right text-sm text-dim tabular-nums">{fmt(st.output)}</td>
                                      <td className="py-3 px-4 text-right text-sm font-bold text-ink tabular-nums">{fmt(st.loss)}</td>
                                      <td className="py-3 px-4 text-right text-sm font-semibold tabular-nums" style={{ color: st.lossPct >= 5 ? 'var(--danger)' : st.lossPct >= 2 ? 'var(--warning)' : 'var(--success)' }}>{pct(st.lossPct)}</td>
                                      <td className="py-3 px-4 text-center"><LossDelta d={st.delta} /></td>
                                      <td className="py-3 px-4"><LoadBar value={st.maxLoad} /></td>
                                    </tr>
                                    {open && (
                                      <tr className="bg-accent-soft/10 border-l-[3px] border-l-accent/40">
                                        <td colSpan={6} className="py-3 px-4">
                                          <div className="text-[11px] font-bold text-faint uppercase tracking-wider mb-2">Chi tiết tổn thất theo khung giờ (kWh)</div>
                                          <div className="flex flex-wrap gap-1.5">
                                            {st.slots.map(sl => (
                                              <span key={sl.time} title={`Tải ${fmt(sl.load, 0)}%`}
                                                className="inline-flex flex-col items-center rounded-md bg-surface border border-[var(--border)] px-1.5 py-1 min-w-[56px]">
                                                <span className="text-[10px] text-faint font-mono">{sl.time}</span>
                                                <span className="text-[11px] font-bold text-accent tabular-nums">{fmt(sl.loss, 2)}</span>
                                              </span>
                                            ))}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })}
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* ---------- TAB BIỂU ĐỒ ---------- */
            chartStations.length === 0 ? (
              <div className="vl-card"><EmptyState icon={BarChart3} title="Không đủ dữ liệu vẽ biểu đồ" /></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {chartStations.map(({ st, kind }) => (
                  <Panel key={st.code}
                    title={st.name}
                    sub={`${st.code} · % TT ${pct(st.lossPct)}`}
                    icon={kind === 'high' ? TrendingUp : TrendingDown}>
                    <div className="px-3 py-3">
                      <div className="flex items-center gap-2 mb-2 text-[11px] font-bold uppercase tracking-wide"
                        style={{ color: kind === 'high' ? 'var(--danger)' : 'var(--success)' }}>
                        {kind === 'high' ? 'Tỷ lệ tổn thất CAO' : 'Tỷ lệ tổn thất THẤP'}
                      </div>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={st.slots} margin={{ top: 8, right: 4, left: 4, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                            <XAxis dataKey="time" tickLine={false} stroke="var(--text-4)" style={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={22} />
                            <YAxis yAxisId="l" hide />
                            <YAxis yAxisId="load" orientation="right" hide domain={[0, 100]} />
                            <Tooltip content={<ChartTooltip fmt={(v, n) => (n === 'Tải %' ? `${fmt(v, 0)}%` : `${fmt(v, 3)} kWh`)} />} />
                            <Bar yAxisId="l" dataKey="loss" name="Tổn thất" radius={[2, 2, 0, 0]} maxBarSize={10}>
                              {st.slots.map((s, i) => <Cell key={i} fill={loadColor(s.load)} />)}
                            </Bar>
                            <Line yAxisId="load" type="monotone" dataKey="load" name="Tải %" stroke={CHART.cd} strokeWidth={2} dot={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
