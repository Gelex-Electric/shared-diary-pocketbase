import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell, LabelList,
} from 'recharts';
import {
  Zap, TrendingUp, TrendingDown, Layers, Activity, BarChart3, Gauge, Building2, RefreshCw, Users,
} from 'lucide-react';
import { Select } from './ui/Select';
import { StatTile, Panel, ChartTooltip, EmptyState, CHART, CustomerZoneCard } from './ui/dashboard';
import {
  useInvoices, tariffSplit, rollupByCustomer, computeKpis, fmtInt, num, ZONE_MAP, zoneCodeOf,
} from '../lib/invoices';
import { usePmaxDaily } from '../lib/pmax';
import { fetchLossMonthly, LossMonthlyRow } from '../lib/transformerLoss';

/** Ngưỡng đánh giá tỷ lệ tổn thất tính toán năm (%). */
const LOSS_TARGET_PCT = 1.5;
const pctVN = (v: number) => v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

const MONTHS = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` }));
const YEAR_BARS = ['var(--text-4)', '#22b8c4', 'var(--accent)'];
const PIE_COLORS = [CHART.bt, CHART.cd, CHART.td];
const pad2 = (n: number) => String(n).padStart(2, '0');
const axisNum = (v: number) => new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];

export default function SummaryDashboard() {
  const endYear = new Date().getFullYear();
  const { bills, records, meterIndex, loading, error, reload, zoneLock } = useInvoices({ endYear, yearsBack: 2, lockToArea: true });
  const { rows: pmaxRows, loading: pmaxLoading } = usePmaxDaily();

  const [year, setYear] = useState<number>(endYear);
  const [tableMonthIdx, setTableMonthIdx] = useState<number>(new Date().getMonth() + 1); // tháng bảng KH, theo năm đã chọn
  const [custA, setCustA] = useState('');   // chart 1 (mặc định: kWh lớn nhất)
  const [custB, setCustB] = useState('');   // chart 2 (mặc định: Pmax lớn nhất)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tableCollapsed, setTableCollapsed] = useState(false);

  const years = useMemo(() => {
    const s = new Set<number>();
    bills.forEach(b => b.year && s.add(b.year));
    pmaxRows.forEach(r => s.add(r.year));
    const arr = Array.from(s).sort((a, b) => b - a);
    return arr.length ? arr : [endYear];
  }, [bills, pmaxRows, endYear]);

  const yearBills = useMemo(() => bills.filter(b => b.year === year), [bills, year]);
  const kpis = useMemo(() => computeKpis(yearBills), [yearBills]);

  /* ── Tổn thất tính toán năm (từ transformer_loss_monthly.csv), lọc theo KCN của tài khoản ── */
  const [lossMonthly, setLossMonthly] = useState<LossMonthlyRow[]>([]);
  useEffect(() => {
    let ok = true;
    fetchLossMonthly().then(r => { if (ok) setLossMonthly(r); }).catch(() => {});
    return () => { ok = false; };
  }, []);
  const lossYear = useMemo(() => {
    const yStr = String(year);
    let loss = 0, out = 0;
    for (const r of lossMonthly) {
      if (r.month.slice(0, 4) !== yStr) continue;
      if (zoneLock && zoneCodeOf(r.code) !== zoneLock) continue;
      loss += r.totalKwh; out += r.outputKwh;
    }
    const denom = out + loss;
    return { pct: denom > 0 ? (loss / denom) * 100 : 0, has: denom > 0 };
  }, [lossMonthly, year, zoneLock]);

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

  /* ── Pmax helpers (chỉ dùng cho biểu đồ theo khách hàng) ── */
  const inZone = useMemo(() => (meter: string) => (!zoneLock ? true : meterIndex.get(meter)?.zone === zoneLock), [zoneLock, meterIndex]);

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

  /* ── Customers: list + default representatives ── */
  const custByKwh = useMemo(() => rollupByCustomer(yearBills).sort((a, b) => b.kwh - a.kwh), [yearBills]);
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

  /* Sản lượng theo THÁNG × NĂM cho 1 khách hàng (giống load3y — vẽ cột nhóm theo năm) */
  const seriesFor = (mkh: string) => {
    const last3 = load3y.years;
    const byYear = new Map<number, number[]>(last3.map(y => [y, Array(12).fill(0)]));
    bills.forEach(b => {
      if (b.mkh !== mkh) return;
      const arr = byYear.get(b.year);
      if (!arr) return;
      const mi = Number(b.month.slice(5, 7)) - 1;
      if (mi >= 0 && mi < 12) arr[mi] += b.slHC;
    });
    return MONTHS.map((label, i) => {
      const row: Record<string, any> = { label };
      last3.forEach(y => { row[String(y)] = Math.round(byYear.get(y)![i]); });
      return row;
    });
  };
  const dataA = useMemo(() => (effA ? seriesFor(effA) : []), [effA, bills, load3y.years]); // eslint-disable-line react-hooks/exhaustive-deps
  const dataB = useMemo(() => (effB ? seriesFor(effB) : []), [effB, bills, load3y.years]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Row 5: per-customer table cho tháng đã chọn, so với tháng liền trước ── */
  const detail = useMemo(() => {
    const cur = `${year}-${pad2(tableMonthIdx)}`;
    const prev = tableMonthIdx === 1 ? `${year - 1}-12` : `${year}-${pad2(tableMonthIdx - 1)}`;
    interface Meter { sct: string; addr: string; curKwh: number; prevKwh: number; curVnd: number; bt: number; cd: number; td: number; }
    interface Cust { mkh: string; name: string; curKwh: number; prevKwh: number; curVnd: number; bt: number; cd: number; td: number; meters: Map<string, Meter>; }
    const map = new Map<string, Cust>();
    if (cur) {
      records.forEach(r => {
        const mkh = (r.MKHang || '').trim();
        if (!mkh) return;
        if (zoneLock && (r.MKHang || '').split('-')[0] !== zoneLock) return;
        const month = dateOnly(r.EndDate).slice(0, 7);
        if (month !== cur && month !== prev) return;
        const kwh = num(r.TongSL_HC), vnd = num(r.ThTien_HC) + num(r.ThTien_PK);
        let c = map.get(mkh);
        if (!c) { c = { mkh, name: r.NMua || mkh, curKwh: 0, prevKwh: 0, curVnd: 0, bt: 0, cd: 0, td: 0, meters: new Map() }; map.set(mkh, c); }
        if (r.NMua && (!c.name || c.name === mkh)) c.name = r.NMua;
        const sct = (r.SCT || '—').trim();
        let mt = c.meters.get(sct);
        if (!mt) { mt = { sct, addr: (r.DChiNMua || '').trim(), curKwh: 0, prevKwh: 0, curVnd: 0, bt: 0, cd: 0, td: 0 }; c.meters.set(sct, mt); }
        if (r.DChiNMua && !mt.addr) mt.addr = (r.DChiNMua || '').trim();
        if (month === cur) {
          c.curKwh += kwh; c.curVnd += vnd; mt.curKwh += kwh; mt.curVnd += vnd;
          const bt = num(r.SL_BT), cd = num(r.SL_CD), td = num(r.SL_TD);   // khung giờ
          c.bt += bt; c.cd += cd; c.td += td;
          mt.bt += bt; mt.cd += cd; mt.td += td;
        }
        else if (month === prev) { c.prevKwh += kwh; mt.prevKwh += kwh; }
      });
    }
    const delta = (a: number, b: number) => (b > 0 ? (a - b) / b : null);
    const rows = Array.from(map.values())
      .filter(c => c.curKwh > 0 || c.curVnd > 0)
      .sort((a, b) => b.curKwh - a.curKwh)
      .map(c => ({
        ...c,
        delta: delta(c.curKwh, c.prevKwh),
        meterList: Array.from(c.meters.values())
          .filter(m => m.curKwh > 0 || m.prevKwh > 0 || m.curVnd > 0)
          .sort((a, b) => b.curKwh - a.curKwh)
          .map(m => ({ ...m, delta: delta(m.curKwh, m.prevKwh) })),
      }));
    return { cur, prev, rows };
  }, [records, zoneLock, year, tableMonthIdx]);

  const fmtMonth = (ym?: string) => (ym ? `${ym.slice(5)}/${ym.slice(0, 4)}` : '—');
  const areaName = zoneLock ? (ZONE_MAP[zoneLock] || zoneLock) : 'Toàn bộ khu công nghiệp';
  const busy = loading || pmaxLoading;
  const thousand = (v: number) => fmtInt(Math.round(v / 1000));

  /* Số trên đỉnh mỗi cột năm — ẩn nếu < 10% giá trị năm cao nhất trong cùng tháng */
  const makeYearBarLabel = (dataArr: any[]) => (props: any) => {
    const { x, y: py, width, value, index } = props;
    if (value == null || width == null) return null;
    const row = dataArr[index];
    const max = Math.max(0, ...load3y.years.map(yr => row[String(yr)] || 0));
    if (max <= 0 || value < max * 0.1) return null;
    return (
      <text x={x + width / 2} y={py - 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--text-3)">
        {axisNum(value)}
      </text>
    );
  };

  /* % hiển thị ngay trong donut */
  const renderTariffPctLabel = (props: any) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
    if (percent < 0.03) return null;
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) / 2;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700}>
        {`${Math.round(percent * 100)}%`}
      </text>
    );
  };

  const renderCustomerChart = (value: string, onChange: (v: string) => void, data: any[]) => (
    <div className="p-4 space-y-3">
      <Select value={value} onChange={onChange} options={custOptions} searchable icon={Users} className="w-full" placeholder="Chọn khách hàng…" />
      <div className="h-[320px]">
        {data.length === 0 ? (
          <EmptyState icon={Activity} title="Chưa có dữ liệu khách hàng" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 16, right: 12, left: 8, bottom: 4 }} barGap={2} barCategoryGap="18%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={thousand} tickLine={false} axisLine={false} stroke="var(--text-4)" width={58} style={{ fontSize: 10 }}
                label={{ value: 'Sản lượng (nghìn kWh)', angle: -90, position: 'insideLeft', offset: 8, style: { fill: 'var(--text-4)', fontSize: 10, textAnchor: 'middle' } }}
              />
              <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {load3y.years.map((y, i) => (
                <Bar key={y} dataKey={String(y)} name={String(y)} fill={YEAR_BARS[i % YEAR_BARS.length]} radius={[3, 3, 0, 0]} maxBarSize={28}>
                  <LabelList dataKey={String(y)} content={makeYearBarLabel(data)} />
                </Bar>
              ))}
            </BarChart>
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

      {/* Row 1 — KPI cards (kWh / ₫ / tổn thất năm) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile label="Sản lượng hữu công" value={fmtInt(kpis.kwh)} unit="kWh" icon={Zap} tone="accent" loading={loading}
          sub={`${fmtInt(kpis.bills)} hóa đơn · ${fmtInt(kpis.customers)} khách hàng`} subTone="neutral" />
        <StatTile label="Doanh thu" value={fmtInt(kpis.vnd)} unit="đồng" icon={TrendingUp} tone="neutral" loading={loading}
          sub={`Đã thu ${Math.round(kpis.collectRate * 100)}% · cosφ ${kpis.avgCosFi ? kpis.avgCosFi.toFixed(3) : '—'}`}
          subTone={kpis.collectRate >= 0.8 ? 'ok' : 'warn'} />
        <StatTile label="Tổn thất tính toán năm" value={lossYear.has ? pctVN(lossYear.pct) : '—'} icon={TrendingDown}
          tone={!lossYear.has ? 'neutral' : lossYear.pct > LOSS_TARGET_PCT ? 'bad' : 'ok'} loading={loading}
          sub={`Mốc ${pctVN(LOSS_TARGET_PCT)} · năm ${year}`}
          subTone={!lossYear.has ? 'neutral' : lossYear.pct > LOSS_TARGET_PCT ? 'bad' : 'ok'} />
      </div>

      {/* Row 2 — monthly load bars (3) + tariff donut (1), 3:1 on xl */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Panel className="xl:col-span-3" title="Biểu đồ phụ tải theo tháng" sub={`So sánh ${load3y.years.length} năm gần nhất · sản lượng (kWh)`} icon={BarChart3}>
          <div className="h-[320px] px-3 py-4">
            {bills.length === 0 ? (
              <EmptyState icon={Activity} title="Chưa có dữ liệu" hint="Không có hóa đơn nào trong khoảng đã tải." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={load3y.data} margin={{ top: 16, right: 12, left: 8, bottom: 4 }} barGap={2} barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 11 }} />
                  <YAxis
                    tickFormatter={thousand} tickLine={false} axisLine={false} stroke="var(--text-4)" width={58} style={{ fontSize: 10 }}
                    label={{ value: 'Sản lượng (nghìn kWh)', angle: -90, position: 'insideLeft', offset: 8, style: { fill: 'var(--text-4)', fontSize: 10, textAnchor: 'middle' } }}
                  />
                  <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {load3y.years.map((y, i) => (
                    <Bar key={y} dataKey={String(y)} name={String(y)} fill={YEAR_BARS[i % YEAR_BARS.length]} radius={[3, 3, 0, 0]} maxBarSize={28}>
                      <LabelList dataKey={String(y)} content={makeYearBarLabel(load3y.data)} />
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel className="xl:col-span-1" title="Cơ cấu phụ tải theo khung giờ" sub={`Năm ${year} · BT / CĐ / TĐ`} icon={Layers}>
          {tariffTotal === 0 ? (
            <EmptyState icon={Layers} title="Chưa có dữ liệu biểu giá" />
          ) : (
            <div className="flex flex-col items-center gap-4 p-5">
              <div className="relative w-[210px] h-[210px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={tariff} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={68} outerRadius={98} paddingAngle={3} cornerRadius={8} stroke="none"
                      label={renderTariffPctLabel} labelLine={false}>
                      {tariff.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xs text-faint">Tổng</span>
                  <span className="text-lg font-bold text-ink tabular-nums leading-tight">{axisNum(tariffTotal)}</span>
                  <span className="text-[11px] text-faint">kWh</span>
                </div>
              </div>
              <div className="w-full space-y-2.5">
                {tariff.map((t, i) => (
                  <div key={t.name} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-xs text-dim flex-1 truncate">{t.name}</span>
                    <span className="text-xs font-semibold text-accent tabular-nums text-right">{fmtInt(t.value)} <span className="text-faint font-normal">kWh</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Row 4 — two customer charts with selectors */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Biểu đồ sản lượng khách hàng" sub={`So sánh ${load3y.years.length} năm gần nhất · sản lượng (kWh)`} icon={Zap}>
          {renderCustomerChart(effA, setCustA, dataA)}
        </Panel>
        <Panel title="Biểu đồ sản lượng khách hàng" sub={`So sánh ${load3y.years.length} năm gần nhất · sản lượng (kWh)`} icon={Gauge}>
          {renderCustomerChart(effB, setCustB, dataB)}
        </Panel>
      </div>

      {/* Row 5 — bảng khách hàng theo tháng, kiểu thẻ gradient thu gọn được */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2"><TrendingUp className="w-4 h-4 text-accent" /> Sản lượng & doanh thu theo khách hàng</h3>
            <p className="text-[11px] text-faint mt-0.5">Tháng {fmtMonth(detail.cur)} so với {fmtMonth(detail.prev)} · bấm KH để xem chi tiết công tơ</p>
          </div>
          <Select value={String(tableMonthIdx)} onChange={v => setTableMonthIdx(Number(v))} options={MONTH_OPTS} className="w-[130px]" />
        </div>

        <CustomerZoneCard
          icon={Building2}
          title={areaName}
          subtitle={`${detail.rows.length} khách hàng`}
          kwh={detail.rows.reduce((s, r) => s + r.curKwh, 0)}
          vnd={detail.rows.reduce((s, r) => s + r.curVnd, 0)}
          rows={detail.rows}
          collapsed={tableCollapsed}
          onToggleCollapse={() => setTableCollapsed(v => !v)}
          expandedRows={expanded}
          onToggleRow={mkh => setExpanded(e => ({ ...e, [mkh]: !e[mkh] }))}
          emptyLabel={busy ? 'Đang tải…' : 'Không có dữ liệu'}
          showTariff
        />
      </div>
    </div>
  );
}
