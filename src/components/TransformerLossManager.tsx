import { useEffect, useMemo, useState } from 'react';
import { Activity, Info, Gauge, TrendingDown, CalendarDays, Clock, Zap } from 'lucide-react';
import { toast as notify } from '../lib/toast';
import {
  fetchLossMonthly, fetchLoss30min,
  LossMonthlyRow, Loss30minRow,
} from '../lib/transformerLoss';
import { Select } from './ui/Select';

/* ---- helpers ---- */
const fmt = (v: number, d = 1) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(v);

const monthVN = (m: string) => {
  const [y, mm] = m.split('-');
  return mm && y ? `Tháng ${mm}/${y}` : m;
};
const dateVN = (k: string) => {
  const [y, m, d] = k.split('-');
  return d ? `${d}/${m}/${y}` : k;
};
const stationName = (r: { lineName: string; code: string }) => r.lineName || r.code;

type View = 'monthly' | 'detail';

export default function TransformerLossManager() {
  const [monthly, setMonthly] = useState<LossMonthlyRow[]>([]);
  const [rows30, setRows30] = useState<Loss30minRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('monthly');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([fetchLossMonthly(), fetchLoss30min()])
      .then(([m, d]) => { if (mounted) { setMonthly(m); setRows30(d); } })
      .catch(err => { console.error(err); notify.error('Lỗi dữ liệu', err?.message || 'Không tải được tổn thất MBA.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  /* ---------- MONTHLY ---------- */
  const months = useMemo(
    () => [...new Set(monthly.map(r => r.month))].sort().reverse(),
    [monthly],
  );
  const [selMonth, setSelMonth] = useState('');
  useEffect(() => { if (months.length && !selMonth) setSelMonth(months[0]); }, [months, selMonth]);

  const monthlyRows = useMemo(
    () => monthly.filter(r => r.month === selMonth).sort((a, b) => b.totalKwh - a.totalKwh),
    [monthly, selMonth],
  );
  const monthTotals = useMemo(() => monthlyRows.reduce(
    (acc, r) => ({
      noload: acc.noload + r.noloadKwh,
      load: acc.load + r.loadKwh,
      total: acc.total + r.totalKwh,
    }), { noload: 0, load: 0, total: 0 }), [monthlyRows]);

  /* ---------- DETAIL 30' ---------- */
  const stations = useMemo(() => {
    const map = new Map<string, string>();
    rows30.forEach(r => { if (!map.has(r.code)) map.set(r.code, stationName(r)); });
    return [...map.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows30]);
  const [selStation, setSelStation] = useState('');
  useEffect(() => { if (stations.length && !selStation) setSelStation(stations[0].code); }, [stations, selStation]);

  const stationDates = useMemo(
    () => [...new Set(rows30.filter(r => r.code === selStation).map(r => r.date))].sort().reverse(),
    [rows30, selStation],
  );
  const [selDate, setSelDate] = useState('');
  useEffect(() => {
    if (stationDates.length && !stationDates.includes(selDate)) setSelDate(stationDates[0]);
  }, [stationDates, selDate]);

  const detailRows = useMemo(
    () => rows30.filter(r => r.code === selStation && r.date === selDate).sort((a, b) => a.time.localeCompare(b.time)),
    [rows30, selStation, selDate],
  );
  const detailTotal = useMemo(() => detailRows.reduce((s, r) => s + r.lossKwh, 0), [detailRows]);

  const hasAnyData = monthly.length > 0 || rows30.length > 0;

  /* ================= RENDER ================= */
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
          Tổn thất kỹ thuật theo công thức <strong>ΔP = P0 + Pk·(S/Sdm)²</strong> cho từng trạm (máy biến áp),
          tính mỗi <strong>30 phút</strong> rồi cộng thành tổn thất tháng. Thông số nhãn MBA nhập tại
          <span className="font-mono text-xs bg-subtle px-1 py-0.5 rounded mx-1">mba_info.csv</span>.
        </p>
      </div>

      {/* Toggle view */}
      <div className="flex items-center gap-2">
        {([['monthly', 'Theo tháng', CalendarDays], ['detail', 'Chi tiết 30 phút', Clock]] as const).map(
          ([v, label, Icon]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                view === v ? 'bg-accent text-[var(--on-accent)]' : 'bg-subtle text-dim hover:bg-[var(--surface-inset)]'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
      </div>

      {loading ? (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-faint">
          <Gauge className="w-12 h-12 mb-3 animate-pulse opacity-40" />
          <p className="font-semibold">Đang tải dữ liệu tổn thất…</p>
        </div>
      ) : !hasAnyData ? (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-faint text-center px-6">
          <Zap className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-semibold">Chưa có dữ liệu tổn thất</p>
          <p className="text-sm mt-1 max-w-md">
            Cần nhập thông số MBA (SDM_KVA, P0_KW, PK_KW) theo mã trạm CODE vào{' '}
            <span className="font-mono text-xs">public/mba_info.csv</span> và chờ pipeline chạy (00:00 hằng ngày).
          </p>
        </div>
      ) : view === 'monthly' ? (
        /* ---------------- MONTHLY ---------------- */
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={selMonth}
              onChange={setSelMonth}
              className="min-w-[180px]"
              options={months.map(m => ({ value: m, label: monthVN(m) }))}
            />
            <span className="text-sm text-soft">{monthlyRows.length} trạm</span>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile label="Tổng tổn thất" value={monthTotals.total} unit="kWh" tone="accent" />
            <StatTile label="Không tải" value={monthTotals.noload} unit="kWh" tone="amber" />
            <StatTile label="Có tải" value={monthTotals.load} unit="kWh" tone="emerald" />
          </div>

          <div className="vl-card overflow-x-auto p-0">
            <table className="w-full text-sm border-collapse min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] font-black uppercase tracking-wider text-faint border-b border-[var(--border)]">
                  <th className="px-4 py-3">Trạm (CODE)</th>
                  <th className="px-4 py-3 text-right">Không tải (kWh)</th>
                  <th className="px-4 py-3 text-right">Có tải (kWh)</th>
                  <th className="px-4 py-3 text-right">Tổng (kWh)</th>
                  <th className="px-4 py-3 text-right">Số mốc 30′</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map(r => (
                  <tr key={r.code} className="border-b border-[var(--border)] hover:bg-subtle transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{stationName(r)}</div>
                      <div className="text-[11px] font-mono text-faint">{r.code}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-dim">{fmt(r.noloadKwh)}</td>
                    <td className="px-4 py-3 text-right font-mono text-dim">{fmt(r.loadKwh)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-accent">{fmt(r.totalKwh)}</td>
                    <td className="px-4 py-3 text-right font-mono text-faint">{r.nIntervals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ---------------- DETAIL 30' ---------------- */
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1.5">
              <Gauge className="w-4 h-4 text-accent shrink-0" />
              <Select
                value={selStation}
                onChange={v => { setSelStation(v); setSelDate(''); }}
                searchable
                className="min-w-[220px]"
                options={stations.map(s => ({ value: s.code, label: s.name }))}
              />
            </div>
            <Select
              value={selDate}
              onChange={setSelDate}
              className="min-w-[160px]"
              options={stationDates.map(d => ({ value: d, label: dateVN(d) }))}
            />
            <span className="ml-auto text-sm text-soft">
              Tổng tổn thất ngày: <strong className="text-accent font-mono">{fmt(detailTotal, 2)} kWh</strong>
            </span>
          </div>

          <div className="vl-card overflow-x-auto p-0">
            <table className="w-full text-sm border-collapse min-w-[720px]">
              <thead>
                <tr className="text-left text-[11px] font-black uppercase tracking-wider text-faint border-b border-[var(--border)]">
                  <th className="px-4 py-3">Giờ</th>
                  <th className="px-4 py-3 text-right">P (kW)</th>
                  <th className="px-4 py-3 text-right">Q (kvar)</th>
                  <th className="px-4 py-3 text-right">S (kVA)</th>
                  <th className="px-4 py-3 text-right">Tải (%)</th>
                  <th className="px-4 py-3 text-right">ΔP (kW)</th>
                  <th className="px-4 py-3 text-right">Tổn thất (kWh)</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map(r => (
                  <tr key={r.dateTime} className="border-b border-[var(--border)] hover:bg-subtle transition-colors">
                    <td className="px-4 py-2.5 font-mono font-semibold text-ink">{r.time}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-dim">{fmt(r.p)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-dim">{fmt(r.q)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-dim">{fmt(r.s)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-dim">{fmt(r.loadPct)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-dim">{fmt(r.deltaP, 3)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-accent">{fmt(r.lossKwh, 3)}</td>
                  </tr>
                ))}
                {detailRows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-faint">Không có dữ liệu cho trạm/ngày đã chọn.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- stat tile ---- */
function StatTile({ label, value, unit, tone }: { label: string; value: number; unit: string; tone: 'accent' | 'amber' | 'emerald' }) {
  const toneCls = tone === 'accent' ? 'text-accent' : tone === 'amber' ? 'text-amber-500' : 'text-emerald-500';
  return (
    <div className="vl-card p-5 flex items-center gap-4">
      <div className={`p-2.5 rounded-xl bg-subtle ${toneCls}`}><Activity className="w-5 h-5" /></div>
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase tracking-wider text-faint">{label}</p>
        <p className="text-xl font-black text-ink font-mono truncate">
          {fmt(value)} <span className="text-sm font-semibold text-soft">{unit}</span>
        </p>
      </div>
    </div>
  );
}
