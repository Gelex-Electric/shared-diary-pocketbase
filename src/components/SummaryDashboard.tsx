import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ComposedChart,
} from 'recharts';
import {
  Zap, TrendingUp, Layers, Activity, BarChart3, Gauge, Building2, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus, ChevronRight, CalendarCheck, Users,
} from 'lucide-react';
import { Select } from './ui/Select';
import { StatTile, Panel, ChartTooltip, EmptyState, CHART } from './ui/dashboard';
import {
  useInvoices, tariffSplit, rollupByCustomer, computeKpis, fmtInt, num, fmtDate, ZONE_MAP,
  fetchEarliestStartDates,
} from '../lib/invoices';
import { usePmaxDaily, type PmaxRow } from '../lib/pmax';

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

export default function SummaryDashboard() {
  const endYear = new Date().getFullYear();
  const { bills, records, meterIndex, loading, error, reload, zoneLock } = useInvoices({ endYear, yearsBack: 2, lockToArea: true });
  const { rows: pmaxRows, loading: pmaxLoading } = usePmaxDaily();

  const [year, setYear] = useState<number>(endYear);
  const [pmaxMonthIdx, setPmaxMonthIdx] = useState<number>(new Date().getMonth() + 1); // 1..12, theo năm đã chọn
  const [custA, setCustA] = useState('');   // chart 1 (mặc định: kWh lớn nhất)
  const [custB, setCustB] = useState('');   // chart 2 (mặc định: Pmax lớn nhất)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [energizeMap, setEnergizeMap] = useState<Map<string, string>>(new Map()); // SCT → ngày đóng điện (query riêng)
  const fetchedRef = useRef<Set<string>>(new Set());

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

  /* ── Pmax helpers ── */
  const inZone = useMemo(() => (meter: string) => (!zoneLock ? true : meterIndex.get(meter)?.zone === zoneLock), [zoneLock, meterIndex]);

  /* Row 3b: daily Pmax for the chosen month */
  const pmaxMonthData = useMemo(() => {
    const m = new Map<string, number>();
    pmaxRows.forEach(r => {
      if (r.date.slice(0, 7) !== pmaxMonth || !inZone(r.meter)) return;
      m.set(r.date, (m.get(r.date) || 0) + r.pmax);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, pmax]) => {
        const [y, mo, d] = date.split('-').map(Number);
        const dow = new Date(y, mo - 1, d).getDay(); // 0=CN .. 6=T7
        return { date, day: date.slice(8, 10), pmax: Math.round(pmax), dow, weekend: dow === 0 || dow === 6, wd: WD[dow], wdFull: WD_FULL[dow] };
      });
  }, [pmaxRows, pmaxMonth, inZone]);

  /* Per-customer daily totals for the selected year → monthly peak + yearly peak */
  const pmaxByCustomer = useMemo(() => {
    const day = new Map<string, Map<string, number>>();
    pmaxRows.forEach(r => {
      if (r.year !== year || !inZone(r.meter)) return;
      const info = meterIndex.get(r.meter);
      if (!info) return;
      let d = day.get(info.mkh);
      if (!d) { d = new Map(); day.set(info.mkh, d); }
      d.set(r.date, (d.get(r.date) || 0) + r.pmax);
    });
    const yearPeak = new Map<string, number>();
    day.forEach((d, mkh) => yearPeak.set(mkh, Math.max(0, ...d.values())));
    return { day, yearPeak };
  }, [pmaxRows, year, inZone, meterIndex]);

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

  /* ── Row 5: per-customer MoM table + per-meter pivot ── */
  const detail = useMemo(() => {
    const monthsDesc = Array.from(new Set(bills.map(b => b.month))).sort((a, b) => b.localeCompare(a));
    const cur = monthsDesc[0], prev = monthsDesc[1];
    interface Meter { sct: string; addr: string; energize: string; curKwh: number; prevKwh: number; curVnd: number; }
    interface Cust { mkh: string; name: string; energize: string; curKwh: number; prevKwh: number; curVnd: number; meters: Map<string, Meter>; }
    const map = new Map<string, Cust>();
    if (cur) {
      records.forEach(r => {
        const mkh = (r.MKHang || '').trim();
        if (!mkh) return;
        if (zoneLock && (r.MKHang || '').split('-')[0] !== zoneLock) return;
        const month = dateOnly(r.EndDate).slice(0, 7);
        const sd = dateOnly(r.StartDate);
        const kwh = num(r.TongSL_HC), vnd = num(r.ThTien_HC) + num(r.ThTien_PK);
        // Tạo/giữ entry cho MỌI bản ghi (không chỉ cur/prev) để "ngày đóng điện"
        // = StartDate sớm nhất trên toàn bộ dữ liệu đã tải, không phải kỳ gần đây.
        let c = map.get(mkh);
        if (!c) { c = { mkh, name: r.NMua || mkh, energize: sd || '9999', curKwh: 0, prevKwh: 0, curVnd: 0, meters: new Map() }; map.set(mkh, c); }
        if (r.NMua && (!c.name || c.name === mkh)) c.name = r.NMua;
        if (sd && sd < c.energize) c.energize = sd;
        const sct = (r.SCT || '—').trim();
        let mt = c.meters.get(sct);
        if (!mt) { mt = { sct, addr: (r.DChiNMua || '').trim(), energize: sd || '9999', curKwh: 0, prevKwh: 0, curVnd: 0 }; c.meters.set(sct, mt); }
        if (sd && sd < mt.energize) mt.energize = sd;
        if (r.DChiNMua && !mt.addr) mt.addr = (r.DChiNMua || '').trim();
        // Sản lượng/doanh thu chỉ cộng cho 2 tháng đang so sánh.
        if (month === cur) { c.curKwh += kwh; c.curVnd += vnd; mt.curKwh += kwh; mt.curVnd += vnd; }
        else if (month === prev) { c.prevKwh += kwh; mt.prevKwh += kwh; }
      });
    }
    const delta = (a: number, b: number) => (b > 0 ? (a - b) / b : null);
    const rows = Array.from(map.values())
      .filter(c => c.curKwh > 0 || c.curVnd > 0)
      .sort((a, b) => b.curKwh - a.curKwh)
      .map(c => ({
        ...c,
        energizeDate: c.energize === '9999' ? '' : c.energize,
        delta: delta(c.curKwh, c.prevKwh),
        meterList: Array.from(c.meters.values())
          .filter(m => m.curKwh > 0 || m.prevKwh > 0 || m.curVnd > 0)
          .sort((a, b) => b.curKwh - a.curKwh)
          .map(m => ({ ...m, energizeDate: m.energize === '9999' ? '' : m.energize, delta: delta(m.curKwh, m.prevKwh) })),
      }));
    return { cur, prev, rows };
  }, [records, bills, zoneLock, meterIndex]);

  /* Cách 2: query riêng StartDate sớm nhất cho các công tơ đang hiển thị (chính xác cả công tơ cũ) */
  useEffect(() => {
    const scts = Array.from(new Set(detail.rows.flatMap(r => r.meterList.map(m => m.sct))))
      .filter(s => s && s !== '—' && !fetchedRef.current.has(s));
    if (scts.length === 0) return;
    scts.forEach(s => fetchedRef.current.add(s));
    fetchEarliestStartDates(scts)
      .then(m => { if (m.size) setEnergizeMap(prev => { const next = new Map(prev); m.forEach((v, k) => next.set(k, v)); return next; }); })
      .catch(() => {});
  }, [detail.rows]);

  /* Ghép ngày đóng điện chính xác (query riêng) đè lên giá trị cục bộ */
  const rows = useMemo(() => detail.rows.map(r => {
    const meterList = r.meterList.map(m => ({ ...m, energizeDate: energizeMap.get(m.sct) || m.energizeDate }));
    const earliest = meterList.map(m => m.energizeDate).filter(Boolean).sort();
    return { ...r, meterList, energizeDate: earliest[0] || r.energizeDate };
  }), [detail.rows, energizeMap]);

  const fmtMonth = (ym?: string) => (ym ? `${ym.slice(5)}/${ym.slice(0, 4)}` : '—');
  const areaName = zoneLock ? (ZONE_MAP[zoneLock] || zoneLock) : 'Toàn bộ khu công nghiệp';
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

  /* Pmax chart: weekday axis tick (Sat/Sun marked), weekend dot, weekday tooltip */
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

        <Panel title="Công suất cực đại (Pmax)" sub={`Theo ngày · ${pmaxMonthIdx}/${year} (kW)`} icon={Gauge}>
          <div className="px-4 pt-3 flex items-center gap-3 flex-wrap">
            <Select value={String(pmaxMonthIdx)} onChange={v => setPmaxMonthIdx(Number(v))} options={MONTH_OPTS} className="w-[120px]" />
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

      {/* Row 5 — MoM table with energization date + per-meter pivot */}
      <Panel title="Sản lượng & doanh thu theo khách hàng"
        sub={`Tháng ${fmtMonth(detail.cur)} so với ${fmtMonth(detail.prev)} · bấm để xem chi tiết công tơ`} icon={TrendingUp}>
        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left">
            <thead><tr>
              <th>Khách hàng</th>
              <th className="text-center">Ngày đóng điện</th>
              <th className="text-right text-ink font-bold border-l border-[var(--border)]">Sản lượng (kWh)</th>
              <th className="text-center">Thay đổi</th>
              <th className="text-right">Doanh thu (đồng)</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-faint text-sm italic">{busy ? 'Đang tải…' : 'Không có dữ liệu'}</td></tr>
              ) : rows.map(r => {
                const open = !!expanded[r.mkh];
                return (
                  <Fragment key={r.mkh}>
                    <tr onClick={() => setExpanded(e => ({ ...e, [r.mkh]: !e[r.mkh] }))}
                      className={`transition-colors cursor-pointer ${open ? 'bg-accent-soft/50' : 'hover:bg-subtle'}`}>
                      <td>
                        <div className="flex items-start gap-2">
                          <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 transition-transform ${open ? 'rotate-90 text-accent' : 'text-faint'}`} />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-ink break-words">{r.name}</div>
                            <div className="text-[11px] text-faint font-mono">{r.mkh} · {r.meterList.length} công tơ</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-center text-xs text-soft whitespace-nowrap"><CalendarCheck className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-faint" />{fmtDate(r.energizeDate)}</td>
                      <td className="text-right text-sm font-bold text-ink tabular-nums border-l border-[var(--border)]">{fmtInt(r.curKwh)}</td>
                      <td className="text-center"><DeltaBadge d={r.delta} /></td>
                      <td className="text-right text-sm text-dim tabular-nums">{fmtInt(r.curVnd)}</td>
                    </tr>
                    {open && r.meterList.map((m, mi) => (
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
                        <td className="text-center text-[11px] text-faint whitespace-nowrap">{fmtDate(m.energizeDate)}</td>
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
      </Panel>
    </div>
  );
}
