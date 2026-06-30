import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, Legend, PieChart, Pie, Cell,
  ComposedChart, Bar,
} from 'recharts';
import {
  Zap, TrendingUp, Layers, Activity, BarChart3, Gauge, Building2, RefreshCw, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import { Select } from './ui/Select';
import { StatTile, Panel, ChartTooltip, EmptyState, CHART } from './ui/dashboard';
import {
  useInvoices, tariffSplit, rollupByCustomer, computeKpis, fmtInt, ZONE_MAP,
} from '../lib/invoices';
import { usePmaxDaily, type PmaxRow } from '../lib/pmax';

const MONTHS = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];
const YEAR_LINE = ['var(--text-4)', '#22b8c4', 'var(--accent)'];
const PIE_COLORS = [CHART.bt, CHART.cd, CHART.td];

/* Compact axis ticks (charts only — KPI cards stay full units). */
const axisNum = (v: number) => new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const fmtKw = (v: number) => fmtInt(Math.round(v)) + ' kW';

export default function SummaryDashboard() {
  const endYear = new Date().getFullYear();
  const { bills, meterIndex, loading, error, reload, zoneLock } = useInvoices({ endYear, yearsBack: 2, lockToArea: true });
  const { rows: pmaxRows, loading: pmaxLoading } = usePmaxDaily();
  const [year, setYear] = useState<number>(endYear);

  const years = useMemo(() => {
    const s = new Set<number>();
    bills.forEach(b => b.year && s.add(b.year));
    pmaxRows.forEach(r => s.add(r.year));
    const arr = Array.from(s).sort((a, b) => b - a);
    return arr.length ? arr : [endYear];
  }, [bills, pmaxRows, endYear]);

  const yearBills = useMemo(() => bills.filter(b => b.year === year), [bills, year]);
  const kpis = useMemo(() => computeKpis(yearBills), [yearBills]);

  /* ── Row 2: monthly load, 3 most-recent years ── */
  const load3y = useMemo(() => {
    const last3 = [...years].sort((a, b) => a - b).slice(-3);
    const byYear = new Map<number, number[]>(last3.map(y => [y, Array(12).fill(0)]));
    bills.forEach(b => {
      const arr = byYear.get(b.year);
      if (!arr) return;
      const mi = Number(b.month.slice(5, 7)) - 1;
      if (mi >= 0 && mi < 12) arr[mi] += b.slHC;
    });
    return {
      years: last3,
      data: MONTHS.map((label, i) => {
        const row: Record<string, any> = { label };
        last3.forEach(y => { row[String(y)] = Math.round(byYear.get(y)![i]); });
        return row;
      }),
    };
  }, [bills, years]);

  /* ── Row 3a: tariff donut ── */
  const tariff = useMemo(() => {
    const t = tariffSplit(yearBills);
    const total = t.bt + t.cd + t.td || 1;
    return [
      { name: 'Bình thường', value: Math.round(t.bt), pct: t.bt / total },
      { name: 'Cao điểm',    value: Math.round(t.cd), pct: t.cd / total },
      { name: 'Thấp điểm',   value: Math.round(t.td), pct: t.td / total },
    ];
  }, [yearBills]);
  const tariffTotal = tariff.reduce((s, x) => s + x.value, 0);

  /* ── Pmax: filter to selected year + zone ── */
  const inZone = useMemo(() => (meter: string) => {
    if (!zoneLock) return true;
    return meterIndex.get(meter)?.zone === zoneLock;
  }, [zoneLock, meterIndex]);

  const pmaxYear = useMemo<PmaxRow[]>(
    () => pmaxRows.filter(r => r.year === year && inZone(r.meter)),
    [pmaxRows, year, inZone],
  );

  /* Row 3b: daily system Pmax (sum across meters per day) */
  const pmaxDaily = useMemo(() => {
    const m = new Map<string, number>();
    pmaxYear.forEach(r => m.set(r.date, (m.get(r.date) || 0) + r.pmax));
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, pmax]) => ({ date, pmax: Math.round(pmax) }));
  }, [pmaxYear]);

  /* Per-customer daily totals → yearly peak + monthly peak */
  const pmaxByCustomer = useMemo(() => {
    const day = new Map<string, Map<string, number>>(); // mkh → date → sum
    pmaxYear.forEach(r => {
      const info = meterIndex.get(r.meter);
      if (!info) return;
      let d = day.get(info.mkh);
      if (!d) { d = new Map(); day.set(info.mkh, d); }
      d.set(r.date, (d.get(r.date) || 0) + r.pmax);
    });
    const yearPeak = new Map<string, number>();
    day.forEach((d, mkh) => yearPeak.set(mkh, Math.max(0, ...d.values())));
    return { day, yearPeak };
  }, [pmaxYear, meterIndex]);

  const monthlyPmaxOf = (mkh: string): number[] => {
    const d = pmaxByCustomer.day.get(mkh);
    const out = Array(12).fill(0);
    if (d) d.forEach((sum, date) => { const mi = Number(date.slice(5, 7)) - 1; if (mi >= 0 && mi < 12) out[mi] = Math.max(out[mi], sum); });
    return out.map(v => Math.round(v));
  };

  /* ── Row 4: two representative customers (max kWh, max Pmax) ── */
  const custByKwh = useMemo(() => rollupByCustomer(yearBills).sort((a, b) => b.kwh - a.kwh), [yearBills]);
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    custByKwh.forEach(c => m.set(c.mkh, c.nMua || c.mkh));
    meterIndex.forEach(v => { if (!m.get(v.mkh)) m.set(v.mkh, v.nMua || v.mkh); });
    return (mkh: string) => m.get(mkh) || mkh;
  }, [custByKwh, meterIndex]);

  const reps = useMemo(() => {
    const repA = custByKwh[0]?.mkh || '';
    const pmaxSorted = Array.from(pmaxByCustomer.yearPeak.entries()).sort((a, b) => b[1] - a[1]);
    let repB = pmaxSorted[0]?.[0] || '';
    if (repB === repA) repB = pmaxSorted.find(([m]) => m !== repA)?.[0] || custByKwh[1]?.mkh || '';
    const build = (mkh: string, kind: 'kwh' | 'pmax') => {
      if (!mkh) return null;
      const kwh = Array(12).fill(0);
      yearBills.filter(b => b.mkh === mkh).forEach(b => { const mi = Number(b.month.slice(5, 7)) - 1; if (mi >= 0 && mi < 12) kwh[mi] += b.slHC; });
      const pmax = monthlyPmaxOf(mkh);
      return {
        mkh, name: nameOf(mkh), kind,
        data: MONTHS.map((label, i) => ({ label, kwh: Math.round(kwh[i]), pmax: pmax[i] })),
      };
    };
    return [build(repA, 'kwh'), build(repB, 'pmax')].filter(Boolean) as Array<{ mkh: string; name: string; kind: string; data: any[] }>;
  }, [custByKwh, pmaxByCustomer, yearBills, nameOf]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Row 5: revenue/consumption vs previous adjacent month ── */
  const momTable = useMemo(() => {
    const monthsDesc = Array.from(new Set(bills.map(b => b.month))).sort((a, b) => b.localeCompare(a));
    const cur = monthsDesc[0], prev = monthsDesc[1];
    if (!cur) return { cur: '', prev: '', rows: [] as any[] };
    const agg = (ym?: string) => {
      const m = new Map<string, { kwh: number; vnd: number; name: string }>();
      if (!ym) return m;
      bills.filter(b => b.month === ym).forEach(b => {
        let e = m.get(b.mkh);
        if (!e) { e = { kwh: 0, vnd: 0, name: b.nMua || b.mkh }; m.set(b.mkh, e); }
        e.kwh += b.slHC; e.vnd += b.dtHC + b.dtVC;
      });
      return m;
    };
    const curM = agg(cur), prevM = agg(prev);
    const rows = Array.from(curM.entries()).map(([mkh, c]) => {
      const p = prevM.get(mkh);
      const delta = p && p.kwh > 0 ? (c.kwh - p.kwh) / p.kwh : null;
      return { mkh, name: c.name, kwh: Math.round(c.kwh), vnd: Math.round(c.vnd), prevKwh: p ? Math.round(p.kwh) : null, delta };
    }).sort((a, b) => b.kwh - a.kwh);
    return { cur, prev, rows };
  }, [bills]);

  const fmtMonth = (ym?: string) => (ym ? `${ym.slice(5)}/${ym.slice(0, 4)}` : '—');
  const areaName = zoneLock ? (ZONE_MAP[zoneLock] || zoneLock) : 'Toàn bộ khu công nghiệp';
  const busy = loading || pmaxLoading;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-ink tracking-tight">Tổng hợp vận hành</h2>
          <p className="text-xs text-faint mt-0.5 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> {areaName} · sản lượng & công suất
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onChange={v => setYear(Number(v))}
            options={years.map(y => ({ value: String(y), label: `Năm ${y}` }))} className="min-w-[130px]" />
          <button onClick={reload} disabled={busy} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Tải lại
          </button>
        </div>
      </div>

      {error && <div className="vl-alert vl-alert-light-danger text-sm">{error}</div>}

      {/* Row 1 — two KPI cards (full kWh / full ₫) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatTile label="Sản lượng hữu công" value={fmtInt(kpis.kwh)} unit="kWh" icon={Zap} tone="accent" loading={loading}
          sub={`${fmtInt(kpis.bills)} hóa đơn · ${fmtInt(kpis.customers)} khách hàng`} subTone="neutral" />
        <StatTile label="Doanh thu" value={fmtInt(kpis.vnd)} unit="đồng" icon={TrendingUp} tone="neutral" loading={loading}
          sub={`Đã thu ${Math.round(kpis.collectRate * 100)}% · cosφ ${kpis.avgCosFi ? kpis.avgCosFi.toFixed(3) : '—'}`}
          subTone={kpis.collectRate >= 0.8 ? 'ok' : 'warn'} />
      </div>

      {/* Row 2 — monthly load, last 3 years */}
      <Panel title="Biểu đồ phụ tải theo tháng" sub={`So sánh ${load3y.years.length} năm gần nhất · sản lượng (kWh)`} icon={BarChart3}>
        <div className="h-[320px] px-3 py-4">
          {bills.length === 0 ? (
            <EmptyState icon={Activity} title="Chưa có dữ liệu" hint="Không có hóa đơn nào trong khoảng đã tải." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={load3y.data} margin={{ top: 16, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 11 }} />
                <YAxis tickFormatter={axisNum} tickLine={false} axisLine={false} stroke="var(--text-4)" width={48} style={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {load3y.years.map((y, i) => (
                  <Line key={y} type="monotone" dataKey={String(y)} name={String(y)}
                    stroke={YEAR_LINE[i % YEAR_LINE.length]} strokeWidth={y === year ? 2.6 : 1.6}
                    dot={false} activeDot={{ r: 4 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      {/* Row 3 — tariff donut + yearly Pmax line */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Cơ cấu phụ tải theo biểu giá" sub={`Năm ${year} · BT / CĐ / TĐ`} icon={Layers}>
          {tariffTotal === 0 ? (
            <EmptyState icon={Layers} title="Chưa có dữ liệu biểu giá" />
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-4 p-5">
              <div className="w-[180px] h-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={tariff} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="var(--surface-1)" strokeWidth={2}>
                      {tariff.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 w-full space-y-3">
                {tariff.map((t, i) => (
                  <div key={t.name} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-sm text-dim flex-1">{t.name}</span>
                    <span className="text-sm font-bold text-ink tabular-nums">{fmtInt(t.value)} <span className="text-faint font-normal text-xs">kWh</span></span>
                    <span className="text-xs font-semibold text-accent tabular-nums w-12 text-right">{(t.pct * 100).toFixed(1)}%</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between">
                  <span className="text-xs text-faint uppercase tracking-wide">Tổng</span>
                  <span className="text-sm font-bold text-ink tabular-nums">{fmtInt(tariffTotal)} kWh</span>
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Công suất cực đại (Pmax)" sub={`Theo ngày · năm ${year} (kW)`} icon={Gauge}>
          <div className="h-[252px] px-3 py-4">
            {pmaxDaily.length === 0 ? (
              <EmptyState icon={Gauge} title={pmaxLoading ? 'Đang tải Pmax…' : 'Chưa có dữ liệu Pmax'} hint="Nguồn: pmax_daily.csv" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pmaxDaily} margin={{ top: 16, right: 12, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} stroke="var(--text-4)" minTickGap={28}
                    tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`} style={{ fontSize: 10 }} />
                  <YAxis tickFormatter={axisNum} tickLine={false} axisLine={false} stroke="var(--text-4)" width={44} style={{ fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip fmt={v => fmtKw(v)} />} />
                  <Line type="monotone" dataKey="pmax" name="Pmax" stroke={CHART.cd} strokeWidth={1.8} dot={false} activeDot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>
      </div>

      {/* Row 4 — two representative customers (kWh bars + Pmax line) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {reps.length === 0 ? (
          <Panel title="Khách hàng đại diện" className="xl:col-span-2"><EmptyState icon={Activity} title="Chưa đủ dữ liệu" /></Panel>
        ) : reps.map(rep => (
          <Panel key={rep.mkh}
            title={rep.kind === 'kwh' ? 'KH sản lượng lớn nhất' : 'KH công suất (Pmax) lớn nhất'}
            sub={`${rep.name} · ${rep.mkh}`} icon={rep.kind === 'kwh' ? Zap : Gauge}>
            <div className="h-[260px] px-3 py-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rep.data} margin={{ top: 16, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 10 }} />
                  <YAxis yAxisId="kwh" tickFormatter={axisNum} tickLine={false} axisLine={false} stroke="var(--accent)" width={44} style={{ fontSize: 10 }} />
                  <YAxis yAxisId="pmax" orientation="right" tickFormatter={axisNum} tickLine={false} axisLine={false} stroke={CHART.cd} width={40} style={{ fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip fmt={(v, n) => n === 'Pmax' ? fmtKw(v) : fmtInt(v) + ' kWh'} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="kwh" dataKey="kwh" name="Sản lượng" fill={CHART.accent} radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Line yAxisId="pmax" type="monotone" dataKey="pmax" name="Pmax" stroke={CHART.cd} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        ))}
      </div>

      {/* Row 5 — MoM table */}
      <Panel title="Sản lượng & doanh thu theo khách hàng"
        sub={`Tháng ${fmtMonth(momTable.cur)} so với ${fmtMonth(momTable.prev)}`} icon={TrendingUp}>
        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left">
            <thead><tr>
              <th>Khách hàng</th>
              <th className="text-right text-ink font-bold border-l border-[var(--border)]">Sản lượng (kWh)</th>
              <th className="text-center">Thay đổi</th>
              <th className="text-right">Doanh thu (đồng)</th>
            </tr></thead>
            <tbody>
              {momTable.rows.length === 0 ? (
                <tr><td colSpan={4} className="py-10 text-center text-faint text-sm italic">{busy ? 'Đang tải…' : 'Không có dữ liệu'}</td></tr>
              ) : momTable.rows.map(r => {
                const up = r.delta != null && r.delta > 0.0005;
                const down = r.delta != null && r.delta < -0.0005;
                const DeltaIcon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
                const tone = up ? 'text-ok' : down ? 'text-bad' : 'text-faint';
                return (
                  <tr key={r.mkh} className="hover:bg-subtle transition-colors">
                    <td>
                      <div className="text-sm font-medium text-ink truncate max-w-[260px]">{r.name}</div>
                      <div className="text-[11px] text-faint font-mono">{r.mkh}</div>
                    </td>
                    <td className="text-right text-sm font-bold text-ink tabular-nums border-l border-[var(--border)]">{fmtInt(r.kwh)}</td>
                    <td className="text-center">
                      <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums ${tone}`}>
                        <DeltaIcon className="w-3.5 h-3.5" />
                        {r.delta == null ? '—' : `${Math.abs(r.delta * 100).toFixed(1)}%`}
                      </span>
                    </td>
                    <td className="text-right text-sm text-dim tabular-nums">{fmtInt(r.vnd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
