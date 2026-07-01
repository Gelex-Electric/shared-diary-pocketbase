import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ComposedChart,
} from 'recharts';
import {
  Zap, TrendingUp, Layers, Activity, BarChart3, Gauge, Building2, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus, ChevronRight, Users,
} from 'lucide-react';
import { Select } from '../ui/Select';
import { StatTile, Panel, ChartTooltip, EmptyState, CHART, ZONE_BARS } from '../ui/dashboard';
import { setLocalNotification, clearLocalNotification } from '../ui/NotificationBell';
import {
  useInvoices, tariffSplit, rollupByCustomer, computeKpis, fmtInt, fmtVNDShort, num, ZONE_MAP, ZONE_ORDER,
} from '../../lib/invoices';
import { usePmaxDaily } from '../../lib/pmax';

const MONTHS = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` }));
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const WD_FULL = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const YEAR_BARS = ['var(--text-4)', '#22b8c4', 'var(--accent)'];
const PIE_COLORS = [CHART.bt, CHART.cd, CHART.td];
const pad2 = (n: number) => String(n).padStart(2, '0');
const axisNum = (v: number) => new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const fmtKw = (v: number) => fmtInt(Math.round(v)) + ' kW';
const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];

export default function BusinessSummaryDashboard() {
  const endYear = new Date().getFullYear();
  const { bills, records, meterIndex, loading, error, reload } = useInvoices({ endYear, yearsBack: 2, lockToArea: false });
  const { rows: pmaxRows, loading: pmaxLoading } = usePmaxDaily();

  const [year, setYear] = useState<number>(endYear);
  const [pmaxMonthIdx, setPmaxMonthIdx] = useState<number>(new Date().getMonth() + 1);
  const [tableMonthIdx, setTableMonthIdx] = useState<number>(new Date().getMonth() + 1);
  const [custA, setCustA] = useState('');
  const [custB, setCustB] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedZones, setCollapsedZones] = useState<Record<string, boolean>>({});

  const pmaxMonth = `${year}-${pad2(pmaxMonthIdx)}`;

  const years = useMemo(() => {
    const s = new Set<number>();
    bills.forEach(b => b.year && s.add(b.year));
    pmaxRows.forEach(r => s.add(r.year));
    const arr = Array.from(s).sort((a, b) => b - a);
    return arr.length ? arr : [endYear];
  }, [bills, pmaxRows, endYear]);

  const yearBills = useMemo(() => bills.filter(b => b.year === year), [bills, year]);
  const kpis = useMemo(() => computeKpis(yearBills), [yearBills]);

  /* Debt reminder on the notification bell */
  useEffect(() => {
    if (loading) return;
    if (kpis.unpaid > 0) {
      setLocalNotification({
        id: 'unpaid-invoices',
        title: 'Công nợ chưa thu',
        message: `Có ${fmtInt(kpis.unpaid)} hóa đơn chưa thanh toán (${fmtVNDShort(kpis.vndDebt)} ₫) trong năm ${year}.`,
        type: 'warning',
      });
    } else {
      clearLocalNotification('unpaid-invoices');
    }
  }, [kpis.unpaid, kpis.vndDebt, year, loading]);

  /* ── Row 2: monthly load (grouped bars), 3 most-recent years ── */
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

  /* ── Stacked: sản lượng tổng theo KCN, 12 tháng lùi từ tháng mới nhất ── */
  const stackByZone = useMemo(() => {
    const months = bills.map(b => b.month).filter(Boolean);
    if (!months.length) return { data: [] as any[], zones: [] as string[] };
    const sorted = months.slice().sort();
    const newest = sorted[sorted.length - 1];
    const [ny, nm] = newest.split('-').map(Number);
    const buckets: string[] = [];
    for (let i = 11; i >= 0; i--) { let m = nm - i, y = ny; while (m <= 0) { m += 12; y--; } buckets.push(`${y}-${pad2(m)}`); }
    const idx = new Map(buckets.map((mk, i) => [mk, i]));
    const zonesPresent = ZONE_ORDER.filter(z => bills.some(b => b.zone === z));
    const rows = buckets.map(mk => {
      const row: Record<string, any> = { label: `${Number(mk.slice(5))}/${mk.slice(2, 4)}` };
      zonesPresent.forEach(z => { row[z] = 0; });
      return row;
    });
    bills.forEach(b => {
      const i = idx.get(b.month);
      if (i == null || !b.zone) return;
      if (rows[i][b.zone] != null) rows[i][b.zone] += b.slHC;
    });
    rows.forEach(r => zonesPresent.forEach(z => { r[z] = Math.round(r[z]); }));
    return { data: rows, zones: zonesPresent };
  }, [bills]);

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

  /* Row 3b: daily Pmax for the chosen month (all zones) */
  const pmaxMonthData = useMemo(() => {
    const m = new Map<string, number>();
    pmaxRows.forEach(r => {
      if (r.date.slice(0, 7) !== pmaxMonth) return;
      m.set(r.date, (m.get(r.date) || 0) + r.pmax);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, pmax]) => {
        const [y, mo, d] = date.split('-').map(Number);
        const dow = new Date(y, mo - 1, d).getDay();
        return { date, day: date.slice(8, 10), pmax: Math.round(pmax), dow, weekend: dow === 0 || dow === 6, wd: WD[dow], wdFull: WD_FULL[dow] };
      });
  }, [pmaxRows, pmaxMonth]);

  /* Per-customer daily totals for the selected year → monthly peak + yearly peak */
  const pmaxByCustomer = useMemo(() => {
    const day = new Map<string, Map<string, number>>();
    pmaxRows.forEach(r => {
      if (r.year !== year) return;
      const info = meterIndex.get(r.meter);
      if (!info) return;
      let d = day.get(info.mkh);
      if (!d) { d = new Map(); day.set(info.mkh, d); }
      d.set(r.date, (d.get(r.date) || 0) + r.pmax);
    });
    const yearPeak = new Map<string, number>();
    day.forEach((d, mkh) => yearPeak.set(mkh, Math.max(0, ...d.values())));
    return { day, yearPeak };
  }, [pmaxRows, year, meterIndex]);

  const monthlyPmaxOf = (mkh: string): number[] => {
    const d = pmaxByCustomer.day.get(mkh);
    const out = Array(12).fill(0);
    if (d) d.forEach((sum, date) => { const mi = Number(date.slice(5, 7)) - 1; if (mi >= 0 && mi < 12) out[mi] = Math.max(out[mi], sum); });
    return out.map(v => Math.round(v));
  };

  /* ── Customers: list + default representatives ── */
  const custByKwh = useMemo(() => rollupByCustomer(yearBills).sort((a, b) => b.kwh - a.kwh), [yearBills]);
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    custByKwh.forEach(c => m.set(c.mkh, c.nMua || c.mkh));
    meterIndex.forEach(v => { if (!m.get(v.mkh)) m.set(v.mkh, v.nMua || v.mkh); });
    return (mkh: string) => m.get(mkh) || mkh;
  }, [custByKwh, meterIndex]);

  const custOptions = useMemo(
    () => custByKwh.map(c => ({ value: c.mkh, label: `${c.nMua || c.mkh} · ${c.mkh}` })),
    [custByKwh],
  );

  const repA = custByKwh[0]?.mkh || '';
  const repB = useMemo(() => {
    const sorted = Array.from(pmaxByCustomer.yearPeak.entries()).sort((a, b) => b[1] - a[1]);
    let b = sorted[0]?.[0] || '';
    if (b === repA) b = sorted.find(([m]) => m !== repA)?.[0] || custByKwh[1]?.mkh || '';
    return b;
  }, [pmaxByCustomer, repA, custByKwh]);

  const effA = custA || repA;
  const effB = custB || repB;

  const seriesFor = (mkh: string) => {
    const kwh = Array(12).fill(0);
    yearBills.filter(b => b.mkh === mkh).forEach(b => { const mi = Number(b.month.slice(5, 7)) - 1; if (mi >= 0 && mi < 12) kwh[mi] += b.slHC; });
    const pmax = monthlyPmaxOf(mkh);
    return MONTHS.map((label, i) => ({ label, kwh: Math.round(kwh[i]), pmax: pmax[i] }));
  };
  const dataA = useMemo(() => (effA ? seriesFor(effA) : []), [effA, yearBills, pmaxByCustomer]); // eslint-disable-line react-hooks/exhaustive-deps
  const dataB = useMemo(() => (effB ? seriesFor(effB) : []), [effB, yearBills, pmaxByCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Row 5: per-customer table grouped by KCN, cho tháng đã chọn ── */
  const detail = useMemo(() => {
    const cur = `${year}-${pad2(tableMonthIdx)}`;
    const prev = tableMonthIdx === 1 ? `${year - 1}-12` : `${year}-${pad2(tableMonthIdx - 1)}`;
    interface Meter { sct: string; addr: string; curKwh: number; prevKwh: number; curVnd: number; }
    interface Cust { mkh: string; name: string; zone: string; curKwh: number; prevKwh: number; curVnd: number; meters: Map<string, Meter>; }
    const map = new Map<string, Cust>();
    records.forEach(r => {
      const mkh = (r.MKHang || '').trim();
      if (!mkh) return;
      const month = dateOnly(r.EndDate).slice(0, 7);
      if (month !== cur && month !== prev) return;
      const kwh = num(r.TongSL_HC), vnd = num(r.ThTien_HC) + num(r.ThTien_PK);
      let c = map.get(mkh);
      if (!c) { c = { mkh, name: r.NMua || mkh, zone: mkh.split('-')[0] || 'Khác', curKwh: 0, prevKwh: 0, curVnd: 0, meters: new Map() }; map.set(mkh, c); }
      if (r.NMua && (!c.name || c.name === mkh)) c.name = r.NMua;
      const sct = (r.SCT || '—').trim();
      let mt = c.meters.get(sct);
      if (!mt) { mt = { sct, addr: (r.DChiNMua || '').trim(), curKwh: 0, prevKwh: 0, curVnd: 0 }; c.meters.set(sct, mt); }
      if (r.DChiNMua && !mt.addr) mt.addr = (r.DChiNMua || '').trim();
      if (month === cur) { c.curKwh += kwh; c.curVnd += vnd; mt.curKwh += kwh; mt.curVnd += vnd; }
      else if (month === prev) { c.prevKwh += kwh; mt.prevKwh += kwh; }
    });
    const delta = (a: number, b: number) => (b > 0 ? (a - b) / b : null);
    const custRows = Array.from(map.values())
      .filter(c => c.curKwh > 0 || c.curVnd > 0)
      .map(c => ({
        mkh: c.mkh, name: c.name, zone: c.zone, curKwh: c.curKwh, curVnd: c.curVnd,
        delta: delta(c.curKwh, c.prevKwh),
        meterList: Array.from(c.meters.values())
          .filter(m => m.curKwh > 0 || m.prevKwh > 0 || m.curVnd > 0)
          .sort((a, b) => b.curKwh - a.curKwh)
          .map(m => ({ ...m, delta: delta(m.curKwh, m.prevKwh) })),
      }));
    const zmap = new Map<string, { code: string; name: string; kwh: number; vnd: number; rows: typeof custRows }>();
    custRows.forEach(c => {
      let z = zmap.get(c.zone);
      if (!z) { z = { code: c.zone, name: ZONE_MAP[c.zone] || c.zone, kwh: 0, vnd: 0, rows: [] }; zmap.set(c.zone, z); }
      z.kwh += c.curKwh; z.vnd += c.curVnd; z.rows.push(c);
    });
    const zones = Array.from(zmap.values()).sort((a, b) => {
      const ia = ZONE_ORDER.indexOf(a.code), ib = ZONE_ORDER.indexOf(b.code);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    zones.forEach(z => z.rows.sort((a, b) => b.curKwh - a.curKwh));
    return { cur, prev, zones };
  }, [records, year, tableMonthIdx]);

  const fmtMonth = (ym?: string) => (ym ? `${ym.slice(5)}/${ym.slice(0, 4)}` : '—');
  const busy = loading || pmaxLoading;

  const DeltaBadge = ({ d }: { d: number | null }) => {
    const up = d != null && d > 0.0005, down = d != null && d < -0.0005;
    const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
    return (
      <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums ${up ? 'text-ok' : down ? 'text-bad' : 'text-faint'}`}>
        <Icon className="w-3.5 h-3.5" />{d == null ? '—' : `${Math.abs(d * 100).toFixed(1)}%`}
      </span>
    );
  };

  /* Pmax chart renderers */
  const renderPmaxTick = (props: any) => {
    const { x, y, payload } = props;
    const pt = pmaxMonthData.find(p => p.day === payload.value);
    const color = pt?.dow === 0 ? 'var(--danger)' : 'var(--warning)';
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={10} textAnchor="middle" fontSize={9} fontWeight={pt?.weekend ? 700 : 400} fill={pt?.weekend ? color : 'var(--text-4)'}>{payload.value}</text>
        {pt?.weekend && <text x={0} y={0} dy={20} textAnchor="middle" fontSize={8} fontWeight={700} fill={color}>{pt.wd}</text>}
      </g>
    );
  };
  const renderPmaxDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || !payload?.weekend) return <g key={payload?.date} />;
    const color = payload.dow === 0 ? 'var(--danger)' : 'var(--warning)';
    return <circle key={payload.date} cx={cx} cy={cy} r={3.2} fill={color} stroke="var(--surface-1)" strokeWidth={1} />;
  };
  const renderPmaxTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="vl-chart-tooltip">
        <div className="vl-chart-tooltip-title">{d.wdFull} · {d.date.slice(8, 10)}/{d.date.slice(5, 7)}</div>
        <div className="vl-chart-tooltip-row">
          <span className="vl-dot" style={{ background: CHART.cd }} />
          <span className="vl-lbl">Pmax</span>
          <span className="vl-val">{fmtKw(payload[0].value)}</span>
        </div>
      </div>
    );
  };

  const renderCustomerChart = (value: string, onChange: (v: string) => void, data: any[]) => (
    <div className="p-4 space-y-3">
      <Select value={value} onChange={onChange} options={custOptions} searchable icon={Users} className="w-full" placeholder="Chọn khách hàng…" />
      <div className="h-[250px]">
        {data.length === 0 ? (
          <EmptyState icon={Activity} title="Chưa có dữ liệu khách hàng" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 16, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 10 }} />
              <YAxis yAxisId="kwh" tickFormatter={axisNum} tickLine={false} axisLine={false} stroke="var(--accent)" width={44} style={{ fontSize: 10 }} />
              <YAxis yAxisId="pmax" orientation="right" tickFormatter={axisNum} tickLine={false} axisLine={false} stroke={CHART.cd} width={40} style={{ fontSize: 10 }} />
              <Tooltip content={<ChartTooltip fmt={(v, n) => (n === 'Pmax' ? fmtKw(v) : fmtInt(v) + ' kWh')} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="kwh" dataKey="kwh" name="Sản lượng" fill={CHART.accent} radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Line yAxisId="pmax" type="monotone" dataKey="pmax" name="Pmax" stroke={CHART.cd} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-ink tracking-tight">Tổng hợp kinh doanh</h2>
          <p className="text-xs text-faint mt-0.5 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> Toàn bộ khu công nghiệp · sản lượng & doanh thu
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

      {/* Row 1 — two KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatTile label="Sản lượng hữu công" value={fmtInt(kpis.kwh)} unit="kWh" icon={Zap} tone="accent" loading={loading}
          sub={`${fmtInt(kpis.bills)} hóa đơn · ${fmtInt(kpis.customers)} khách hàng`} subTone="neutral" />
        <StatTile label="Doanh thu" value={fmtInt(kpis.vnd)} unit="đồng" icon={TrendingUp} tone="neutral" loading={loading}
          sub={`Đã thu ${Math.round(kpis.collectRate * 100)}% · công nợ ${fmtVNDShort(kpis.vndDebt)} ₫`}
          subTone={kpis.collectRate >= 0.8 ? 'ok' : 'warn'} />
      </div>

      {/* Row 2 — monthly load bars, last 3 years */}
      <Panel title="Biểu đồ phụ tải theo tháng" sub={`So sánh ${load3y.years.length} năm gần nhất · sản lượng (kWh)`} icon={BarChart3}>
        <div className="h-[320px] px-3 py-4">
          {bills.length === 0 ? (
            <EmptyState icon={Activity} title="Chưa có dữ liệu" hint="Không có hóa đơn nào trong khoảng đã tải." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={load3y.data} margin={{ top: 16, right: 12, left: 8, bottom: 4 }} barGap={2} barCategoryGap="18%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 11 }} />
                <YAxis tickFormatter={axisNum} tickLine={false} axisLine={false} stroke="var(--text-4)" width={48} style={{ fontSize: 10 }} />
                <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {load3y.years.map((y, i) => (
                  <Bar key={y} dataKey={String(y)} name={String(y)} fill={YEAR_BARS[i % YEAR_BARS.length]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      {/* Stacked: sản lượng theo KCN, 12 tháng gần nhất */}
      {stackByZone.zones.length > 0 && (
        <Panel title="Sản lượng theo khu công nghiệp" sub="12 tháng gần nhất · xếp chồng theo KCN (kWh)" icon={Layers}>
          <div className="h-[300px] px-3 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackByZone.data} margin={{ top: 16, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 10 }} />
                <YAxis tickFormatter={axisNum} tickLine={false} axisLine={false} stroke="var(--text-4)" width={48} style={{ fontSize: 10 }} />
                <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {stackByZone.zones.map((z, i) => (
                  <Bar key={z} dataKey={z} name={ZONE_MAP[z] || z} stackId="kcn"
                    fill={ZONE_BARS[i % ZONE_BARS.length]}
                    radius={i === stackByZone.zones.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} maxBarSize={40} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* Row 3 — tariff donut + monthly Pmax line */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Cơ cấu phụ tải theo biểu giá" sub={`Năm ${year} · BT / CĐ / TĐ`} icon={Layers}>
          {tariffTotal === 0 ? (
            <EmptyState icon={Layers} title="Chưa có dữ liệu biểu giá" />
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-6 p-5">
              <div className="relative w-[190px] h-[190px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={tariff} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={88} paddingAngle={3} cornerRadius={8} stroke="none">
                      {tariff.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[11px] text-faint">Tổng</span>
                  <span className="text-lg font-bold text-ink tabular-nums leading-tight">{axisNum(tariffTotal)}</span>
                  <span className="text-[10px] text-faint">kWh</span>
                </div>
              </div>
              <div className="flex-1 w-full space-y-3.5">
                {tariff.map((t, i) => (
                  <div key={t.name} className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-sm text-dim flex-1 truncate">{t.name}</span>
                    <span className="text-xs text-faint tabular-nums w-12 text-right">{(t.pct * 100).toFixed(1)}%</span>
                    <span className="text-sm font-semibold text-accent tabular-nums w-24 text-right">{fmtInt(t.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Công suất cực đại (Pmax)" sub={`Theo ngày · ${pmaxMonthIdx}/${year} (kW)`} icon={Gauge}
          actions={<Select value={String(pmaxMonthIdx)} onChange={v => setPmaxMonthIdx(Number(v))} options={MONTH_OPTS} className="w-[130px]" />}>
          <div className="px-4 pt-3 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-soft"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--warning)' }} />Thứ 7</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-soft"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--danger)' }} />Chủ nhật</span>
          </div>
          <div className="h-[244px] px-3 pb-4 pt-2">
            {pmaxMonthData.length === 0 ? (
              <EmptyState icon={Gauge} title={pmaxLoading ? 'Đang tải Pmax…' : 'Chưa có dữ liệu Pmax'} hint="Nguồn: pmax_daily.csv" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pmaxMonthData} margin={{ top: 16, right: 12, left: 8, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} stroke="var(--text-4)" interval={0} height={28} tick={renderPmaxTick} />
                  <YAxis tickFormatter={axisNum} tickLine={false} axisLine={false} stroke="var(--text-4)" width={44} style={{ fontSize: 10 }} />
                  <Tooltip content={renderPmaxTooltip} />
                  <Line type="monotone" dataKey="pmax" name="Pmax" stroke={CHART.cd} strokeWidth={2} dot={renderPmaxDot} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>
      </div>

      {/* Row 4 — two customer charts with selectors */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Biểu đồ sản lượng & công suất khách hàng" sub={`Sản lượng (kWh) & Pmax (kW) · năm ${year}`} icon={Zap}>
          {renderCustomerChart(effA, setCustA, dataA)}
        </Panel>
        <Panel title="Biểu đồ sản lượng & công suất khách hàng" sub={`Sản lượng (kWh) & Pmax (kW) · năm ${year}`} icon={Gauge}>
          {renderCustomerChart(effB, setCustB, dataB)}
        </Panel>
      </div>

      {/* Row 5 — per-KCN accordion tables */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2"><TrendingUp className="w-4 h-4 text-accent" /> Sản lượng & doanh thu theo khách hàng</h3>
            <p className="text-[11px] text-faint mt-0.5">Tháng {fmtMonth(detail.cur)} so với {fmtMonth(detail.prev)} · tách theo khu công nghiệp · bấm KH để xem công tơ</p>
          </div>
          <Select value={String(tableMonthIdx)} onChange={v => setTableMonthIdx(Number(v))} options={MONTH_OPTS} className="w-[130px]" />
        </div>

        {detail.zones.length === 0 ? (
          <div className="vl-card"><EmptyState icon={TrendingUp} title={busy ? 'Đang tải…' : 'Không có dữ liệu tháng này'} /></div>
        ) : (
          <div className="vl-accordion">
            {detail.zones.map(z => {
              const open = !collapsedZones[z.code];
              return (
                <div key={z.code} className={`vl-accordion-item ${open ? 'is-open' : ''}`}>
                  <button className="vl-accordion-header" onClick={() => setCollapsedZones(c => ({ ...c, [z.code]: !c[z.code] }))}>
                    <Building2 className="w-4 h-4 shrink-0" />
                    <span className="font-bold">{z.name}</span>
                    <span className="text-[11px] font-medium text-faint">({z.rows.length} KH)</span>
                    <span className="ml-auto flex items-center gap-4 mr-2">
                      <span className="text-xs tabular-nums text-dim">{fmtInt(z.kwh)} <span className="text-faint">kWh</span></span>
                      <span className="text-xs font-bold tabular-nums text-accent">{fmtInt(z.vnd)} <span className="text-faint font-normal">đ</span></span>
                    </span>
                    <ChevronRight className="vl-accordion-chevron w-4 h-4" />
                  </button>
                  {open && (
                    <div className="vl-accordion-body overflow-x-auto">
                      <table className="vl-table w-full text-left">
                        <thead><tr>
                          <th>Khách hàng</th>
                          <th className="text-right text-ink font-bold border-l border-[var(--border)]">Sản lượng (kWh)</th>
                          <th className="text-center">Thay đổi</th>
                          <th className="text-right">Doanh thu (đồng)</th>
                        </tr></thead>
                        <tbody>
                          {z.rows.map(r => {
                            const cOpen = !!expanded[r.mkh];
                            return (
                              <Fragment key={r.mkh}>
                                <tr onClick={() => setExpanded(e => ({ ...e, [r.mkh]: !e[r.mkh] }))}
                                  className={`transition-colors cursor-pointer ${cOpen ? 'bg-accent-soft/50' : 'hover:bg-subtle'}`}>
                                  <td>
                                    <div className="flex items-start gap-2">
                                      <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 transition-transform ${cOpen ? 'rotate-90 text-accent' : 'text-faint'}`} />
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-ink break-words">{r.name}</div>
                                        <div className="text-[11px] text-faint font-mono">{r.mkh} · {r.meterList.length} công tơ</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="text-right text-sm font-bold text-ink tabular-nums border-l border-[var(--border)]">{fmtInt(r.curKwh)}</td>
                                  <td className="text-center"><DeltaBadge d={r.delta} /></td>
                                  <td className="text-right text-sm text-dim tabular-nums">{fmtInt(r.curVnd)}</td>
                                </tr>
                                {cOpen && r.meterList.map((m, mi) => (
                                  <tr key={r.mkh + '|' + m.sct}
                                    className={`bg-subtle/60 ${mi === r.meterList.length - 1 ? 'border-b-2 border-b-[var(--border-strong)]' : ''}`}>
                                    <td className="py-2">
                                      <div className="flex items-stretch gap-2 pl-6">
                                        <span className="w-[3px] rounded-full bg-accent/40 shrink-0" />
                                        <div className="min-w-0">
                                          <div className="text-xs font-mono font-semibold text-dim">CT {m.sct}</div>
                                          {m.addr && <div className="text-[10px] text-faint truncate max-w-[240px]">{m.addr}</div>}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="text-right text-xs font-semibold text-dim tabular-nums border-l border-[var(--border)]">{fmtInt(m.curKwh)}</td>
                                    <td className="text-center"><DeltaBadge d={m.delta} /></td>
                                    <td className="text-right text-xs text-soft tabular-nums">{fmtInt(m.curVnd)}</td>
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
