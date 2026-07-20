import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Line, PieChart, Pie, Cell, ComposedChart, LabelList,
} from 'recharts';
import {
  Zap, TrendingUp, Layers, Activity, BarChart3, Gauge, Building2, RefreshCw, Users, AlertTriangle, Wallet,
} from 'lucide-react';
import { Select } from '../ui/Select';
import { StatTile, Panel, ChartTooltip, EmptyState, CHART, ZONE_BARS, CustomerZoneCard } from '../ui/dashboard';
import { setLocalNotification, clearLocalNotification } from '../ui/NotificationBell';
import {
  useInvoices, tariffSplit, rollupByCustomer, computeKpis, fmtInt, fmtVNDShort, num, ZONE_MAP, ZONE_ORDER,
} from '../../lib/invoices';
import { usePmaxDaily } from '../../lib/pmax';

const MONTHS = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` }));
const YEAR_BARS = ['var(--text-4)', '#22b8c4', 'var(--accent)'];
const PIE_COLORS = [CHART.bt, CHART.cd, CHART.td];
const pad2 = (n: number) => String(n).padStart(2, '0');
const axisNum = (v: number) => new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const fmtKw = (v: number) => fmtInt(Math.round(v)) + ' kW';
const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];

/* Chip tích chọn (KCN + năm) — đồng bộ 1 màu accent. */
function FilterChip({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={on}
        onChange={onToggle}
        className="w-3.5 h-3.5 rounded border-[var(--border-strong)] cursor-pointer"
        style={{ accentColor: 'var(--accent)' }}
      />
      <span className={`text-xs font-medium ${on ? 'text-ink' : 'text-faint'}`}>{label}</span>
    </label>
  );
}

export default function BusinessSummaryDashboard() {
  const endYear = new Date().getFullYear();
  const { bills, records, meterIndex, loading, error, reload } = useInvoices({ endYear, yearsBack: 2, lockToArea: false });
  const { rows: pmaxRows, loading: pmaxLoading } = usePmaxDaily();

  /* Năm: TÍCH CHỌN NHIỀU (checkbox). KCN: tích chọn (ẩn/hiện). */
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set([endYear]));
  const [tableMonthIdx, setTableMonthIdx] = useState<number>(new Date().getMonth() + 1);
  const [custA, setCustA] = useState('');
  const [custB, setCustB] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedZones, setCollapsedZones] = useState<Record<string, boolean>>({});
  /* KCN bị ẩn — dùng chung cho MỌI biểu đồ/bảng/KPI. */
  const [hiddenZones, setHiddenZones] = useState<Record<string, boolean>>({});

  const years = useMemo(() => {
    const s = new Set<number>();
    bills.forEach(b => b.year && s.add(b.year));
    pmaxRows.forEach(r => s.add(r.year));
    const arr = Array.from(s).sort((a, b) => b - a);
    return arr.length ? arr : [endYear];
  }, [bills, pmaxRows, endYear]);

  /* Nếu năm mặc định không có dữ liệu → chọn năm mới nhất có dữ liệu. */
  useEffect(() => {
    if (years.length && ![...selectedYears].some(y => years.includes(y))) {
      setSelectedYears(new Set([years[0]]));
    }
  }, [years]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleYear = (y: number) =>
    setSelectedYears(prev => {
      const n = new Set(prev);
      n.has(y) ? n.delete(y) : n.add(y);
      if (n.size === 0) n.add(y); // luôn giữ ít nhất 1 năm
      return n;
    });
  const yearsSorted = useMemo(() => [...selectedYears].sort((a, b) => a - b), [selectedYears]);
  const yearsLabel = yearsSorted.join(', ');

  const zoneOn = (z: string) => !hiddenZones[z];
  const toggleZoneVisible = (z: string) => setHiddenZones(h => ({ ...h, [z]: !h[z] }));

  /* Hoá đơn đã lọc theo KCN đang bật + năm đang chọn — NGUỒN CHUNG cho mọi thành phần. */
  const filteredBills = useMemo(
    () => bills.filter(b => selectedYears.has(b.year) && zoneOn(b.zone)),
    [bills, selectedYears, hiddenZones],
  );

  const kpis = useMemo(() => computeKpis(filteredBills), [filteredBills]);

  /* Debt reminder on the notification bell */
  useEffect(() => {
    if (loading) return;
    if (kpis.unpaid > 0) {
      setLocalNotification({
        id: 'unpaid-invoices',
        title: 'Công nợ chưa thu',
        message: `Có ${fmtInt(kpis.unpaid)} hóa đơn chưa thanh toán (${fmtVNDShort(kpis.vndDebt)} ₫) trong năm ${yearsLabel}.`,
        type: 'warning',
      });
    } else {
      clearLocalNotification('unpaid-invoices');
    }
  }, [kpis.unpaid, kpis.vndDebt, yearsLabel, loading]);

  /* Toàn bộ KCN có dữ liệu — dùng để vẽ chip chọn + màu cột. */
  const zoneCatalog = useMemo(() => ZONE_ORDER.filter(z => bills.some(b => b.zone === z)), [bills]);

  /* ── Biểu đồ phụ tải theo tháng — nhóm cột theo TỪNG NĂM đang chọn, chỉ KCN đang bật ── */
  const loadByYear = useMemo(() => {
    const ys = yearsSorted;
    const byYear = new Map<number, number[]>(ys.map(y => [y, Array(12).fill(0)]));
    filteredBills.forEach(b => {
      const arr = byYear.get(b.year);
      if (!arr) return;
      const mi = Number(b.month.slice(5, 7)) - 1;
      if (mi >= 0 && mi < 12) arr[mi] += b.slHC;
    });
    return {
      years: ys,
      data: MONTHS.map((label, i) => {
        const row: Record<string, any> = { label };
        ys.forEach(y => { row[String(y)] = Math.round(byYear.get(y)![i]); });
        return row;
      }),
    };
  }, [filteredBills, yearsSorted]);

  /* ── Sản lượng theo KCN — các tháng của NĂM đang chọn, chỉ KCN đang bật ── */
  const stackByZone = useMemo(() => {
    const zonesPresent = zoneCatalog.filter(z => zoneOn(z));
    const buckets = Array.from(new Set(filteredBills.map(b => b.month).filter(Boolean))).sort();
    const idx = new Map(buckets.map((mk, i) => [mk, i]));
    const rows = buckets.map(mk => {
      const row: Record<string, any> = { label: `${Number(mk.slice(5))}/${mk.slice(2, 4)}` };
      zonesPresent.forEach(z => { row[z] = 0; });
      return row;
    });
    filteredBills.forEach(b => {
      const i = idx.get(b.month);
      if (i == null || !b.zone) return;
      if (rows[i][b.zone] != null) rows[i][b.zone] += b.slHC;
    });
    rows.forEach(r => zonesPresent.forEach(z => { r[z] = Math.round(r[z]); }));
    return { data: rows, zones: zonesPresent };
  }, [filteredBills, zoneCatalog, hiddenZones]);

  /* ── Cơ cấu phụ tải theo khung giờ (donut) — lọc KCN + năm ── */
  const tariff = useMemo(() => {
    const t = tariffSplit(filteredBills);
    const total = t.bt + t.cd + t.td || 1;
    return [
      { name: 'Bình thường', value: Math.round(t.bt), pct: t.bt / total },
      { name: 'Cao điểm',    value: Math.round(t.cd), pct: t.cd / total },
      { name: 'Thấp điểm',   value: Math.round(t.td), pct: t.td / total },
    ];
  }, [filteredBills]);
  const tariffTotal = tariff.reduce((s, x) => s + x.value, 0);

  /* Tần suất theo khung giờ theo KCN — lọc KCN + năm. */
  const freqByZone = useMemo(() => {
    const m = new Map<string, { code: string; bt: number; cd: number; td: number }>();
    filteredBills.forEach(b => {
      const code = b.zone || 'Khác';
      let z = m.get(code);
      if (!z) { z = { code, bt: 0, cd: 0, td: 0 }; m.set(code, z); }
      z.bt += b.slBT; z.cd += b.slCD; z.td += b.slTD;
    });
    return Array.from(m.values())
      .sort((a, b) => (ZONE_ORDER.indexOf(a.code) + 1 || 99) - (ZONE_ORDER.indexOf(b.code) + 1 || 99))
      .map(z => {
        const t = z.bt + z.cd + z.td || 1;
        return {
          code: z.code,
          name: ZONE_MAP[z.code] || z.code,
          btPct: +(z.bt / t * 100).toFixed(1), cdPct: +(z.cd / t * 100).toFixed(1), tdPct: +(z.td / t * 100).toFixed(1),
          bt: Math.round(z.bt), cd: Math.round(z.cd), td: Math.round(z.td),
        };
      });
  }, [filteredBills]);

  /* Per-customer daily peaks cho các NĂM đang chọn, chỉ KCN đang bật. */
  const pmaxByCustomer = useMemo(() => {
    const day = new Map<string, Map<string, number>>();
    pmaxRows.forEach(r => {
      if (!selectedYears.has(r.year)) return;
      const info = meterIndex.get(r.meter);
      if (!info) return;
      const zone = (info.mkh.split('-')[0] || '');
      if (!zoneOn(zone)) return;
      let d = day.get(info.mkh);
      if (!d) { d = new Map(); day.set(info.mkh, d); }
      d.set(r.date, (d.get(r.date) || 0) + r.pmax);
    });
    const yearPeak = new Map<string, number>();
    day.forEach((d, mkh) => yearPeak.set(mkh, Math.max(0, ...d.values())));
    return { day, yearPeak };
  }, [pmaxRows, selectedYears, hiddenZones, meterIndex]);

  const monthlyPmaxOf = (mkh: string): number[] => {
    const d = pmaxByCustomer.day.get(mkh);
    const out = Array(12).fill(0);
    if (d) d.forEach((sum, date) => { const mi = Number(date.slice(5, 7)) - 1; if (mi >= 0 && mi < 12) out[mi] = Math.max(out[mi], sum); });
    return out.map(v => Math.round(v));
  };

  /* ── Customers ── */
  const custByKwh = useMemo(() => rollupByCustomer(filteredBills).sort((a, b) => b.kwh - a.kwh), [filteredBills]);
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
    filteredBills.filter(b => b.mkh === mkh).forEach(b => { const mi = Number(b.month.slice(5, 7)) - 1; if (mi >= 0 && mi < 12) kwh[mi] += b.slHC; });
    const pmax = monthlyPmaxOf(mkh);
    return MONTHS.map((label, i) => ({ label, kwh: Math.round(kwh[i]), pmax: pmax[i] }));
  };
  const dataA = useMemo(() => (effA ? seriesFor(effA) : []), [effA, filteredBills, pmaxByCustomer]); // eslint-disable-line react-hooks/exhaustive-deps
  const dataB = useMemo(() => (effB ? seriesFor(effB) : []), [effB, filteredBills, pmaxByCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Bảng KH theo KCN, cho tháng đã chọn — cộng gộp các NĂM đang chọn, chỉ KCN đang bật ── */
  const detail = useMemo(() => {
    const curMonths = new Set(yearsSorted.map(y => `${y}-${pad2(tableMonthIdx)}`));
    const prevMonths = new Set(yearsSorted.map(y => tableMonthIdx === 1 ? `${y - 1}-12` : `${y}-${pad2(tableMonthIdx - 1)}`));
    interface Meter { sct: string; addr: string; curKwh: number; prevKwh: number; curVnd: number; }
    interface Cust { mkh: string; name: string; zone: string; curKwh: number; prevKwh: number; curVnd: number; meters: Map<string, Meter>; }
    const map = new Map<string, Cust>();
    records.forEach(r => {
      const mkh = (r.MKHang || '').trim();
      if (!mkh) return;
      const zone = mkh.split('-')[0] || 'Khác';
      if (!zoneOn(zone)) return;
      const month = dateOnly(r.EndDate).slice(0, 7);
      const isCur = curMonths.has(month), isPrev = prevMonths.has(month);
      if (!isCur && !isPrev) return;
      const kwh = num(r.TongSL_HC), vnd = num(r.ThTien_HC) + num(r.ThTien_PK);
      let c = map.get(mkh);
      if (!c) { c = { mkh, name: r.NMua || mkh, zone, curKwh: 0, prevKwh: 0, curVnd: 0, meters: new Map() }; map.set(mkh, c); }
      if (r.NMua && (!c.name || c.name === mkh)) c.name = r.NMua;
      const sct = (r.SCT || '—').trim();
      let mt = c.meters.get(sct);
      if (!mt) { mt = { sct, addr: (r.DChiNMua || '').trim(), curKwh: 0, prevKwh: 0, curVnd: 0 }; c.meters.set(sct, mt); }
      if (r.DChiNMua && !mt.addr) mt.addr = (r.DChiNMua || '').trim();
      if (isCur) { c.curKwh += kwh; c.curVnd += vnd; mt.curKwh += kwh; mt.curVnd += vnd; }
      else if (isPrev) { c.prevKwh += kwh; mt.prevKwh += kwh; }
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
    return { zones };
  }, [records, selectedYears, tableMonthIdx, hiddenZones]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = loading || pmaxLoading;
  const thousand = (v: number) => fmtInt(Math.round(v / 1000));
  const collectPct = Math.round(kpis.collectRate * 100);

  /* Màu cố định theo KCN — DÙNG CHO CỘT BIỂU ĐỒ (để phân biệt các KCN). Chip chọn dùng màu accent chung. */
  const zoneColor = useMemo(
    () => new Map(zoneCatalog.map((z, i) => [z, ZONE_BARS[i % ZONE_BARS.length]])),
    [zoneCatalog],
  );

  const renderYearBarLabel = (props: any) => {
    const { x, y: py, width, value, index } = props;
    if (value == null || width == null) return null;
    const row = loadByYear.data[index];
    const max = Math.max(0, ...loadByYear.years.map(yr => row[String(yr)] || 0));
    if (max <= 0 || value < max * 0.1) return null;
    return (
      <text x={x + width / 2} y={py - 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--text-3)">
        {axisNum(value)}
      </text>
    );
  };

  const renderZoneStackLabel = (zoneCode: string) => (props: any) => {
    const { x, y: py, width, height, value, index } = props;
    if (!value || width == null || height < 14) return null;
    const row = stackByZone.data[index];
    const total = stackByZone.zones.reduce((s, z) => s + (row[z] || 0), 0) || 1;
    if (value / total < 0.1) return null;
    return (
      <text x={x + width / 2} y={py + height / 2} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fill="#fff">
        {axisNum(value)}
      </text>
    );
  };

  const renderFreqPctLabel = (props: any) => {
    const { x, y: py, width, height, value } = props;
    if (!value || width < 20) return null;
    return (
      <text x={x + width / 2} y={py + height / 2} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fill="#fff">
        {`${Math.round(value)}%`}
      </text>
    );
  };

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
            <Building2 className="w-3.5 h-3.5" /> KCN &amp; năm đã chọn · sản lượng &amp; doanh thu
          </p>
        </div>
      </div>

      {error && <div className="vl-alert vl-alert-light-danger text-sm">{error}</div>}

      {/* Row 1.5 — bộ TÍCH CHỌN KCN + năm (đồng bộ màu accent). Lọc TOÀN BỘ KPI/biểu đồ/bảng bên dưới. */}
      <div className="bg-surface border border-[var(--border)] rounded-[var(--radius)] px-4 py-3 flex flex-col gap-2.5" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-start gap-x-4 gap-y-2 flex-wrap">
          <span className="text-[11px] font-semibold text-faint uppercase tracking-wide shrink-0 mt-0.5">Khu công nghiệp</span>
          {zoneCatalog.length === 0 ? (
            <span className="text-xs text-faint italic">Chưa có dữ liệu</span>
          ) : zoneCatalog.map(z => (
            <FilterChip key={z} on={zoneOn(z)} label={ZONE_MAP[z] || z} onToggle={() => toggleZoneVisible(z)} />
          ))}
        </div>
        <div className="h-px bg-[var(--border)]" />
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
          <span className="text-[11px] font-semibold text-faint uppercase tracking-wide shrink-0">Năm</span>
          {years.map(y => (
            <FilterChip key={y} on={selectedYears.has(y)} label={String(y)} onToggle={() => toggleYear(y)} />
          ))}
          <button onClick={reload} disabled={busy} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50 ml-auto">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Tải lại
          </button>
        </div>
      </div>

      {/* Row 1 — sản lượng · doanh thu · công nợ (KPI, lọc theo KCN + năm) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile label="Sản lượng hữu công" value={fmtInt(kpis.kwh)} unit="kWh" icon={Zap} tone="accent" loading={loading}
          sub={`${fmtInt(kpis.bills)} hóa đơn · ${fmtInt(kpis.customers)} khách hàng`} subTone="neutral" />
        <StatTile label="Doanh thu" value={fmtInt(kpis.vnd)} unit="đồng" icon={TrendingUp} tone="neutral" loading={loading}
          sub={`TB ${fmtInt(kpis.bills > 0 ? Math.round(kpis.vnd / kpis.bills) : 0)} đồng/hóa đơn`} subTone="neutral" />

        <div
          className="bg-surface border border-[var(--border)] rounded-[var(--radius)] p-4 flex flex-col gap-2.5"
          style={{ borderLeft: `3px solid ${kpis.vndDebt > 0 ? 'var(--danger)' : 'var(--success)'}`, boxShadow: 'var(--shadow-card)' }}
        >
          <div className="flex items-center gap-2">
            <span className={`vl-lamp ${kpis.vndDebt > 0 ? 'trip' : 'on'}`} />
            <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-soft flex-1 min-w-0 truncate">Công nợ</span>
            <AlertTriangle className="w-4 h-4 text-faint shrink-0" />
          </div>
          {loading ? (
            <div className="h-8 w-2/3 rounded bg-subtle animate-pulse" />
          ) : (
            <div className="flex items-baseline gap-1.5">
              <span className="text-[1.75rem] leading-none font-semibold text-ink tabular-nums tracking-tight">{fmtInt(kpis.vndDebt)}</span>
              <span className="text-sm text-soft font-medium">đồng</span>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="h-1.5 rounded-full bg-subtle overflow-hidden">
              <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${collectPct}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] font-semibold tabular-nums">
              <span className="text-ok flex items-center gap-1"><Wallet className="w-3 h-3" /> {collectPct}% đã thu</span>
              <span className="text-bad">{fmtInt(kpis.unpaid)} hóa đơn nợ</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2 — monthly load bars (theo năm chọn) + tariff donut, 3:1 on xl */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Panel className="xl:col-span-3" title="Biểu đồ phụ tải theo tháng" sub={`Năm ${yearsLabel} · sản lượng (kWh) · lọc theo KCN`} icon={BarChart3}>
          <div className="h-[320px] px-3 py-4">
            {loadByYear.data.every(r => loadByYear.years.every(y => !r[String(y)])) ? (
              <EmptyState icon={Activity} title="Chưa có dữ liệu" hint="Không có hóa đơn nào với KCN/năm đang chọn." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={loadByYear.data} margin={{ top: 16, right: 12, left: 8, bottom: 4 }} barGap={2} barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 11 }} />
                  <YAxis
                    tickFormatter={thousand} tickLine={false} axisLine={false} stroke="var(--text-4)" width={58} style={{ fontSize: 10 }}
                    label={{ value: 'Sản lượng (nghìn kWh)', angle: -90, position: 'insideLeft', offset: 8, style: { fill: 'var(--text-4)', fontSize: 10, textAnchor: 'middle' } }}
                  />
                  <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {loadByYear.years.map((y, i) => (
                    <Bar key={y} dataKey={String(y)} name={String(y)} fill={YEAR_BARS[i % YEAR_BARS.length]} radius={[3, 3, 0, 0]} maxBarSize={28}>
                      <LabelList dataKey={String(y)} content={renderYearBarLabel} />
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel className="xl:col-span-1" title="Cơ cấu phụ tải theo khung giờ" sub={`Năm ${yearsLabel} · lọc theo KCN`} icon={Layers}>
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

      {/* Row 3 — stacked kWh theo KCN + tần suất khung giờ theo KCN, 3:1 */}
      {zoneCatalog.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          <Panel className="xl:col-span-3" title="Sản lượng theo khu công nghiệp" sub={`Năm ${yearsLabel} · lọc theo bộ chọn KCN`} icon={Layers}>
            <div className="h-[300px] xl:h-[380px] px-3 py-4">
              {stackByZone.zones.length === 0 || stackByZone.data.length === 0 ? (
                <EmptyState icon={Layers} title="Không có dữ liệu" hint="Bật lại KCN hoặc chọn năm có dữ liệu." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stackByZone.data} margin={{ top: 16, right: 12, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 10 }} />
                    <YAxis
                      tickFormatter={thousand} tickLine={false} axisLine={false} stroke="var(--text-4)" width={58} style={{ fontSize: 10 }}
                      label={{ value: 'Sản lượng (nghìn kWh)', angle: -90, position: 'insideLeft', offset: 8, style: { fill: 'var(--text-4)', fontSize: 10, textAnchor: 'middle' } }}
                    />
                    <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' kWh'} />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {stackByZone.zones.map((z, i) => (
                      <Bar key={z} dataKey={z} name={ZONE_MAP[z] || z} stackId="kcn"
                        fill={zoneColor.get(z)!}
                        radius={i === stackByZone.zones.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} maxBarSize={40}>
                        <LabelList dataKey={z} content={renderZoneStackLabel(z)} />
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Panel>

          <Panel className="xl:col-span-1" title="Tần suất khung giờ theo KCN" sub={`Năm ${yearsLabel} · tỷ trọng BT / CĐ / TĐ`} icon={BarChart3}>
            <div className="h-[300px] px-3 py-4">
              {freqByZone.length === 0 ? (
                <EmptyState icon={BarChart3} title="Chưa có dữ liệu" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={freqByZone} margin={{ top: 8, right: 8, left: 4, bottom: 4 }} stackOffset="expand">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--surface-inset)" />
                    <XAxis type="number" domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 9 }} />
                    <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} stroke="var(--text-3)" width={92} style={{ fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip fmt={v => `${v}%`} />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="btPct" name="Bình thường" stackId="f" maxBarSize={22} fill={PIE_COLORS[0]}>
                      <LabelList dataKey="btPct" content={renderFreqPctLabel} />
                    </Bar>
                    <Bar dataKey="cdPct" name="Cao điểm" stackId="f" maxBarSize={22} fill={PIE_COLORS[1]}>
                      <LabelList dataKey="cdPct" content={renderFreqPctLabel} />
                    </Bar>
                    <Bar dataKey="tdPct" name="Thấp điểm" stackId="f" radius={[0, 3, 3, 0]} maxBarSize={22} fill={PIE_COLORS[2]}>
                      <LabelList dataKey="tdPct" content={renderFreqPctLabel} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Panel>
        </div>
      )}

      {/* Row 4 — two customer charts with selectors */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Biểu đồ sản lượng & công suất khách hàng" sub={`Sản lượng (kWh) & Pmax (kW) · năm ${yearsLabel}`} icon={Zap}>
          {renderCustomerChart(effA, setCustA, dataA)}
        </Panel>
        <Panel title="Biểu đồ sản lượng & công suất khách hàng" sub={`Sản lượng (kWh) & Pmax (kW) · năm ${yearsLabel}`} icon={Gauge}>
          {renderCustomerChart(effB, setCustB, dataB)}
        </Panel>
      </div>

      {/* Row 5 — bảng khách hàng theo từng KCN */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2"><TrendingUp className="w-4 h-4 text-accent" /> Sản lượng & doanh thu theo khách hàng</h3>
            <p className="text-[11px] text-faint mt-0.5">Tháng {tableMonthIdx} · năm {yearsLabel} · so tháng liền trước · tách theo KCN · bấm KH để xem công tơ</p>
          </div>
          <Select value={String(tableMonthIdx)} onChange={v => setTableMonthIdx(Number(v))} options={MONTH_OPTS} className="w-[130px]" />
        </div>

        {detail.zones.length === 0 ? (
          <div className="vl-card"><EmptyState icon={TrendingUp} title={busy ? 'Đang tải…' : 'Không có dữ liệu tháng này'} /></div>
        ) : (
          <div className="space-y-4">
            {detail.zones.map(z => (
              <CustomerZoneCard
                key={z.code}
                icon={Building2}
                title={z.name}
                subtitle={`${z.rows.length} khách hàng`}
                kwh={z.kwh}
                vnd={z.vnd}
                rows={z.rows}
                collapsed={!!collapsedZones[z.code]}
                onToggleCollapse={() => setCollapsedZones(c => ({ ...c, [z.code]: !c[z.code] }))}
                expandedRows={expanded}
                onToggleRow={mkh => setExpanded(e => ({ ...e, [mkh]: !e[mkh] }))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
