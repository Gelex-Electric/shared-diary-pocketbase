import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Legend, LabelList, Cell,
} from 'recharts';
import {
  DollarSign, Wallet, AlertTriangle, Zap, BarChart3, PieChart as PieIcon,
  Building2, RefreshCw, UserX,
} from 'lucide-react';
import { Select } from '../ui/Select';
import { StatTile, Panel, ChartTooltip, EmptyState, CHART, ZONE_BARS } from '../ui/dashboard';
import { setLocalNotification, clearLocalNotification } from '../ui/NotificationBell';
import {
  useInvoices, rollupByCustomer, rollupByZone, computeKpis,
  fmtInt, fmtKWhShort, fmtVNDShort,
} from '../../lib/invoices';

const MONTHS = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];

export default function BusinessSummaryDashboard() {
  const endYear = new Date().getFullYear();
  const { bills, loading, error, reload } = useInvoices({ endYear, yearsBack: 2, lockToArea: false });
  const [year, setYear] = useState<number>(endYear);

  const years = useMemo(() => {
    const s = new Set<number>();
    bills.forEach(b => b.year && s.add(b.year));
    const arr = Array.from(s).sort((a, b) => b - a);
    return arr.length ? arr : [endYear];
  }, [bills, endYear]);

  const yearBills = useMemo(() => bills.filter(b => b.year === year), [bills, year]);
  const kpis = useMemo(() => computeKpis(yearBills), [yearBills]);

  /* Monthly revenue split paid vs debt */
  const monthly = useMemo(() => {
    const paid = Array(12).fill(0), debt = Array(12).fill(0);
    yearBills.forEach(b => {
      const mi = Number(b.month.slice(5, 7)) - 1;
      if (mi < 0 || mi > 11) return;
      const money = b.dtHC + b.dtVC;
      if (b.paid) paid[mi] += money; else debt[mi] += money;
    });
    return MONTHS.map((label, i) => ({ label, paid: Math.round(paid[i]), debt: Math.round(debt[i]) }));
  }, [yearBills]);

  const zones = useMemo(() => rollupByZone(yearBills), [yearBills]);
  const topDebtors = useMemo(
    () => rollupByCustomer(yearBills).filter(c => c.vndDebt > 0).sort((a, b) => b.vndDebt - a.vndDebt).slice(0, 10),
    [yearBills],
  );

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

  const collectPct = Math.round(kpis.collectRate * 100);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-ink tracking-tight">Tổng hợp kinh doanh</h2>
          <p className="text-xs text-faint mt-0.5 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> Doanh thu & công nợ toàn bộ khu công nghiệp
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
        <StatTile label="Doanh thu" value={fmtVNDShort(kpis.vnd)} unit="₫" icon={DollarSign} tone="accent" loading={loading}
          sub={`${fmtInt(kpis.bills)} hóa đơn · ${fmtInt(kpis.customers)} KH`} subTone="neutral" />
        <StatTile label="Đã thu" value={fmtVNDShort(kpis.vndPaid)} unit="₫" icon={Wallet} tone="ok" loading={loading}
          sub={`Tỷ lệ thu ${collectPct}%`} subTone={collectPct >= 80 ? 'ok' : 'warn'} />
        <StatTile label="Công nợ" value={fmtVNDShort(kpis.vndDebt)} unit="₫" icon={AlertTriangle}
          tone={kpis.vndDebt > 0 ? 'bad' : 'ok'} loading={loading}
          sub={`${fmtInt(kpis.unpaid)} hóa đơn chưa thu`} subTone={kpis.unpaid > 0 ? 'bad' : 'ok'} />
        <StatTile label="Sản lượng" value={fmtKWhShort(kpis.kwh)} unit="kWh" icon={Zap} tone="neutral" loading={loading}
          sub={`cosφ ${kpis.avgCosFi ? kpis.avgCosFi.toFixed(3) : '—'}`} subTone="neutral" />
      </div>

      {/* Monthly revenue + collection status */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel className="xl:col-span-2" title={`Doanh thu theo tháng · ${year}`} sub="Đã thu so với công nợ (₫)" icon={BarChart3}>
          <div className="h-[300px] px-3 py-4">
            {yearBills.length === 0 ? (
              <EmptyState icon={BarChart3} title="Chưa có dữ liệu" hint="Không có hóa đơn nào trong năm đã chọn." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 20, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 11 }} />
                  <YAxis tickFormatter={fmtVNDShort} tickLine={false} axisLine={false} stroke="var(--text-4)" width={52} style={{ fontSize: 10 }} />
                  <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' ₫'} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="paid" name="Đã thu" stackId="m" fill={CHART.ok} maxBarSize={42} />
                  <Bar dataKey="debt" name="Công nợ" stackId="m" fill={CHART.bad} radius={[4, 4, 0, 0]} maxBarSize={42} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel title="Tình hình thu nợ" sub={`Năm ${year}`} icon={PieIcon}>
          <div className="p-5 flex flex-col items-center gap-5">
            <div className="relative w-36 h-36">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--surface-inset)" strokeWidth="3.5" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--success)" strokeWidth="3.5" strokeLinecap="round"
                  strokeDasharray={`${collectPct * 0.974} 100`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-ink tabular-nums">{collectPct}%</span>
                <span className="text-[10px] text-faint uppercase tracking-wide">đã thu</span>
              </div>
            </div>
            <div className="w-full space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-dim"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--success)' }} /> Đã thu</span>
                <span className="font-bold text-ink tabular-nums">{fmtVNDShort(kpis.vndPaid)} ₫</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-dim"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--danger)' }} /> Công nợ</span>
                <span className="font-bold text-bad tabular-nums">{fmtVNDShort(kpis.vndDebt)} ₫</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Revenue by zone */}
      {zones.length > 1 && (
        <Panel title="Doanh thu theo khu vực" sub={`Năm ${year}`} icon={Building2}>
          <div className="h-[260px] px-3 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={zones.map(z => ({ name: z.code, vnd: Math.round(z.vnd) }))} margin={{ top: 4, right: 64, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--surface-inset)" />
                <XAxis type="number" tickFormatter={fmtVNDShort} tickLine={false} axisLine={false} stroke="var(--text-4)" style={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} stroke="var(--text-3)" width={64} style={{ fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip fmt={v => fmtInt(v) + ' ₫'} />} />
                <Bar dataKey="vnd" name="Doanh thu" radius={[0, 4, 4, 0]} maxBarSize={26}>
                  {zones.map((_, i) => <Cell key={i} fill={ZONE_BARS[i % ZONE_BARS.length]} />)}
                  <LabelList dataKey="vnd" position="right" formatter={(v: any) => fmtVNDShort(v)} style={{ fontSize: 10, fill: 'var(--text-3)' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* Top debtors */}
      <Panel title="Khách hàng công nợ lớn nhất" sub={`Hóa đơn chưa thanh toán · ${year}`} icon={UserX}>
        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left">
            <thead><tr>
              <th>Khách hàng</th>
              <th className="text-center">Khu vực</th>
              <th className="text-right">Doanh thu</th>
              <th className="text-right">Đã thu</th>
              <th className="text-right text-bad font-bold border-l border-[var(--border)]">Công nợ</th>
              <th className="text-center">Chưa thu</th>
            </tr></thead>
            <tbody>
              {topDebtors.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-faint text-sm italic">
                  {loading ? 'Đang tải…' : 'Không có công nợ — đã thu hết'}
                </td></tr>
              ) : topDebtors.map(c => (
                <tr key={c.mkh} className="hover:bg-subtle transition-colors">
                  <td>
                    <div className="text-sm font-medium text-ink truncate max-w-[240px]">{c.nMua || c.mkh}</div>
                    <div className="text-[11px] text-faint font-mono">{c.mkh}</div>
                  </td>
                  <td className="text-center"><span className="vl-badge-primary text-[10px] font-bold px-2 py-0.5 rounded">{c.zone || '—'}</span></td>
                  <td className="text-right text-xs text-dim tabular-nums">{fmtVNDShort(c.vnd)}</td>
                  <td className="text-right text-xs text-ok tabular-nums">{fmtVNDShort(c.vndPaid)}</td>
                  <td className="text-right text-sm font-bold text-bad tabular-nums border-l border-[var(--border)]">{fmtVNDShort(c.vndDebt)}</td>
                  <td className="text-center"><span className="vl-badge-danger text-[11px] font-bold px-2 py-0.5 rounded tabular-nums">{c.unpaid}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
