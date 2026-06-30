import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, LineChart, Line, Legend, LabelList, Cell,
} from 'recharts';
import {
  Zap, Gauge, Users, Activity, BarChart3, Layers, Trophy,
  Building2, RefreshCw, TrendingUp,
} from 'lucide-react';
import { Select } from './ui/Select';
import { StatTile, Panel, ChartTooltip, EmptyState, CHART, ZONE_BARS } from './ui/dashboard';
import {
  useInvoices, tariffSplit, rollupByCustomer, rollupByZone,
  computeKpis, fmtInt, fmtKWhShort, fmtVNDShort, ZONE_MAP,
} from '../lib/invoices';

const MONTHS = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];
const YEAR_LINE = ['var(--text-4)', '#22b8c4', 'var(--accent)'];

export default function SummaryDashboard() {
  const endYear = new Date().getFullYear();
  const { bills, loading, error, reload, zoneLock } = useInvoices({ endYear, yearsBack: 2, lockToArea: true });
  const [year, setYear] = useState<number>(endYear);

  /* Years present in the loaded window */
  const years = useMemo(() => {
    const s = new Set<number>();
    bills.forEach(b => b.year && s.add(b.year));
    const arr = Array.from(s).sort((a, b) => b - a);
    return arr.length ? arr : [endYear];
  }, [bills, endYear]);

  const yearBills = useMemo(() => bills.filter(b => b.year === year), [bills, year]);
  const kpis = useMemo(() => computeKpis(yearBills), [yearBills]);

  /* Monthly kWh + revenue for the selected year (12 fixed buckets) */
  const monthly = useMemo(() => {
    const k = Array(12).fill(0), v = Array(12).fill(0);
    yearBills.forEach(b => {
      const mi = Number(b.month.slice(5, 7)) - 1;
      if (mi >= 0 && mi < 12) { k[mi] += b.slHC; v[mi] += b.dtHC + b.dtVC; }
    });
    return MONTHS.map((label, i) => ({ label, kwh: Math.round(k[i]), vnd: Math.round(v[i]) }));
  }, [yearBills]);

  /* Year-over-year monthly kWh */
  const yoy = useMemo(() => {
    const byYear = new Map<number, number[]>();
    bills.forEach(b => {
      if (!byYear.has(b.year)) byYear.set(b.year, Array(12).fill(0));
      const mi = Number(b.month.slice(5, 7)) - 1;
      if (mi >= 0 && mi < 12) byYear.get(b.year)![mi] += b.slHC;
    });
    const chronological = Array.from(byYear.keys()).sort((a, b) => a - b);
    return {
      data: MONTHS.map((label, i) => {
        const row: Record<string, any> = { label };
        chronological.forEach(y => { row[String(y)] = Math.round(byYear.get(y)![i]); });
        return row;
      }),
      years: chronological,
    };
  }, [bills]);

  const tariff = useMemo(() => {
    const t = tariffSplit(yearBills);
    const total = t.bt + t.cd + t.td || 1;
    return [
      { name: 'Bình thường', key: 'bt', kwh: Math.round(t.bt), pct: t.bt / total, color: CHART.bt },
      { name: 'Cao điểm',    key: 'cd', kwh: Math.round(t.cd), pct: t.cd / total, color: CHART.cd },
      { name: 'Thấp điểm',   key: 'td', kwh: Math.round(t.td), pct: t.td / total, color: CHART.td },
    ];
  }, [yearBills]);

  const topConsumers = useMemo(
    () => rollupByCustomer(yearBills).sort((a, b) => b.kwh - a.kwh).slice(0, 8),
    [yearBills],
  );
  const zones = useMemo(() => rollupByZone(yearBills), [yearBills]);
  const showZones = !zoneLock && zones.length > 1;

  const areaName = zoneLock ? (ZONE_MAP[zoneLock] || zoneLock) : 'Toàn bộ khu công nghiệp';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-ink tracking-tight">Tổng hợp vận hành</h2>
          <p className="text-xs text-faint mt-0.5 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> {areaName} · sản lượng & chỉ tiêu kỹ thuật
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(year)}
            onChange={v => setYear(Number(v))}
            options={years.map(y => ({ value: String(y), label: `Năm ${y}` }))}
            className="min-w-[130px]"
          />
          <button onClick={reload} disabled={loading} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Tải lại
          </button>
        </div>
      </div>

      {error && <div className="vl-alert vl-alert-light-danger text-sm">{error}</div>}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Sản lượng hữu công" value={fmtKWhShort(kpis.kwh)} unit="kWh" icon={Zap} tone="accent" loading={loading}
          sub={`${fmtInt(kpis.bills)} hóa đơn`} subTone="neutral" />
        <StatTile label="Doanh thu" value={fmtVNDShort(kpis.vnd)} unit="₫" icon={TrendingUp} tone="neutral" loading={loading}
          sub={`Đã thu ${Math.round(kpis.collectRate * 100)}%`} subTone={kpis.collectRate >= 0.8 ? 'ok' : 'warn'} />
        <StatTile label="Hệ số công suất cosφ" value={kpis.avgCosFi ? kpis.avgCosFi.toFixed(3) : '—'} icon={Gauge}
          tone={kpis.avgCosFi >= 0.9 ? 'ok' : kpis.avgCosFi > 0 ? 'warn' : 'neutral'} loading={loading}
          sub={`Vô công ${(kpis.reactiveRatio * 100).toFixed(1)}% sản lượng`}
          subTone={kpis.reactiveRatio > 0.3 ? 'warn' : 'neutral'} />
        <StatTile label="Khách hàng" value={fmtInt(kpis.customers)} icon={Users} tone="neutral" loading={loading}
          sub={showZones ? `${zones.length} khu vực` : areaName} subTone="neutral" />
      </div>

      {/* Monthly consumption + tariff mix */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel className="xl:col-span-2" title={`Sản lượng theo tháng · ${year}`} sub="Hữu công (kWh) theo kỳ chốt chỉ số" icon={BarChart3}>
          <div className="h-[300px] px-3 py-4">
            {yearBills.length === 0 ? (
              <EmptyState icon={Activity} title="Chưa có dữ liệu" hint="Không có hóa đơn nào trong năm đã chọn." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 20, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 11 }} />
                  <YAxis tickFormatter={fmtKWhShort} tickLine={false} axisLine={false} stroke="var(--text-4)" width={48} style={{ fontSize: 10 }} />
                  <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                  <Bar dataKey="kwh" name="Sản lượng" fill={CHART.accent} radius={[4, 4, 0, 0]} maxBarSize={42}>
                    <LabelList dataKey="kwh" position="top" formatter={(v: any) => (v ? fmtKWhShort(v) : '')} style={{ fontSize: 10, fill: 'var(--text-3)' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel title="Cơ cấu phụ tải" sub="Theo biểu giá (kWh)" icon={Layers}>
          <div className="p-5 space-y-4">
            {tariff.every(t => t.kwh === 0) ? (
              <EmptyState icon={Layers} title="Chưa có dữ liệu biểu giá" />
            ) : tariff.map(t => (
              <div key={t.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-2 text-xs font-medium text-dim">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} /> {t.name}
                  </span>
                  <span className="text-xs font-bold text-ink tabular-nums">{fmtInt(t.kwh)} <span className="text-faint font-normal">kWh</span></span>
                </div>
                <div className="h-2 rounded-full bg-subtle overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(t.pct * 100, 1)}%`, background: t.color }} />
                </div>
                <div className="text-[10px] text-faint mt-1 tabular-nums">{(t.pct * 100).toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Year over year */}
      {yoy.years.length > 1 && (
        <Panel title="So sánh sản lượng theo năm" sub="Hữu công (kWh) theo tháng" icon={TrendingUp}>
          <div className="h-[280px] px-3 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yoy.data} margin={{ top: 16, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtKWhShort} tickLine={false} axisLine={false} stroke="var(--text-4)" width={48} style={{ fontSize: 10 }} />
                <Tooltip content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {yoy.years.map((y, i) => (
                  <Line key={y} type="monotone" dataKey={String(y)} name={String(y)}
                    stroke={YEAR_LINE[i % YEAR_LINE.length]} strokeWidth={y === year ? 2.5 : 1.5}
                    dot={false} activeDot={{ r: 4 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* Top consumers + zones */}
      <div className={`grid grid-cols-1 ${showZones ? 'xl:grid-cols-2' : ''} gap-4`}>
        <Panel title="Khách hàng tiêu thụ lớn nhất" sub={`Top theo sản lượng · ${year}`} icon={Trophy}>
          <div className="overflow-x-auto">
            <table className="vl-table w-full text-left">
              <thead><tr>
                <th>Khách hàng</th>
                <th className="text-right text-ink font-bold border-l border-[var(--border)]">Sản lượng (kWh)</th>
                <th className="text-right">Doanh thu</th>
              </tr></thead>
              <tbody>
                {topConsumers.length === 0 ? (
                  <tr><td colSpan={3} className="py-8 text-center text-faint text-sm italic">Không có dữ liệu</td></tr>
                ) : topConsumers.map((c, i) => (
                  <tr key={c.mkh} className="hover:bg-subtle transition-colors">
                    <td>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-accent-soft text-accent text-[11px] font-bold grid place-items-center shrink-0 tabular-nums">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink truncate max-w-[220px]">{c.nMua || c.mkh}</div>
                          <div className="text-[11px] text-faint font-mono">{c.mkh}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-right text-sm font-bold text-ink border-l border-[var(--border)]">{fmtInt(c.kwh)}</td>
                    <td className="text-right text-xs text-dim">{fmtVNDShort(c.vnd)} ₫</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {showZones && (
          <Panel title="Sản lượng theo khu vực" sub={`Năm ${year}`} icon={Building2}>
            <div className="h-[260px] px-3 py-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={zones.map(z => ({ name: z.code, kwh: Math.round(z.kwh) }))} margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--surface-inset)" />
                  <XAxis type="number" tickFormatter={fmtKWhShort} tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} stroke="var(--text-3)" width={64} style={{ fontSize: 11 }} />
                  <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                  <Bar dataKey="kwh" name="Sản lượng" radius={[0, 4, 4, 0]} maxBarSize={26}>
                    {zones.map((_, i) => <Cell key={i} fill={ZONE_BARS[i % ZONE_BARS.length]} />)}
                    <LabelList dataKey="kwh" position="right" formatter={(v: any) => fmtKWhShort(v)} style={{ fontSize: 10, fill: 'var(--text-3)' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
