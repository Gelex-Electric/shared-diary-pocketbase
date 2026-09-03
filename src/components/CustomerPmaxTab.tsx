/* Tab "Pmax khách hàng" của trang Đồ thị điện áp & công suất.
   Nguồn dữ liệu: public/pmax_daily.csv (METER_NO, DATE, PMAX_KW) qua lib/pmax.
   Quy tắc gộp (user chốt 03/09/2026): Pmax của khách hàng trong tháng =
   GIÁ TRỊ LỚN NHẤT của MỘT công tơ (KHÔNG cộng các công tơ với nhau), vì đỉnh
   của các điểm đo không trùng thời điểm nên cộng lại sẽ cao hơn thực tế. */
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Bar, Cell,
} from 'recharts';
import { Gauge, TrendingUp, Users, HelpCircle, Zap } from 'lucide-react';
import { usePmaxDaily } from '../lib/pmax';
import { MonthPicker } from './ui/DateTimePickers';
import { Select } from './ui/Select';
import { StatTile, ChartTooltip, EmptyState, CHART } from './ui/dashboard';

/** Khách hàng + danh sách công tơ — khớp cấu trúc CustomerInfo của trang cha. */
export interface PmaxCustomer {
  id: string;
  mkh: string;
  name: string;
  meters: { meterNo: string; line: string }[];
}

interface Props {
  /** Khách hàng ĐÃ lọc theo KCN của tài khoản đang đăng nhập (trang cha lo việc lọc). */
  customers: PmaxCustomer[];
}

interface RankRow {
  id: string;
  mkh: string;
  name: string;
  pmax: number;
  date: string;    // ngày đạt đỉnh (YYYY-MM-DD)
  meterNo: string; // công tơ đạt đỉnh
  line: string;    // tên trạm của công tơ đó
  meterCount: number;
}

const p2 = (n: number) => String(n).padStart(2, '0');

const fmtDateVN = (key: string) => {
  if (!key) return '—';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};

const fmtKw = (v: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(v);

/** Điểm đo ĐẦU NGUỒN — đo tổng toàn bộ các điểm đo khác trong KCN, KHÔNG phải phụ tải
    của một khách hàng. Phải tách khỏi bảng xếp hạng, nếu không nó luôn đứng hạng 1 và
    làm sai Pmax trung bình. Nhận diện theo LINE_NAME (user xác nhận 03/09/2026: chỉ
    KCN Thuận Thành I có, các KCN khác không có điểm đo kiểu này). */
const HEAD_LINES = new Set(['TTI.DIEMDOPHU']);
const isHeadMeter = (line: string) => HEAD_LINES.has((line || '').trim().toUpperCase());

export default function CustomerPmaxTab({ customers }: Props) {
  const { rows, loading, error } = usePmaxDaily();

  /* Tách công tơ đầu nguồn khỏi danh sách khách hàng (tính riêng bên dưới) */
  const { loadCustomers, headMeters } = useMemo(() => {
    const load: PmaxCustomer[] = [];
    const head: { meterNo: string; line: string; name: string }[] = [];
    for (const c of customers) {
      const own = c.meters.filter(m => !isHeadMeter(m.line));
      c.meters
        .filter(m => isHeadMeter(m.line))
        .forEach(m => head.push({ meterNo: m.meterNo, line: m.line, name: c.name }));
      if (own.length > 0) load.push({ ...c, meters: own });
    }
    return { loadCustomers: load, headMeters: head };
  }, [customers]);

  /* Tháng có dữ liệu trong CSV → mặc định chọn tháng mới nhất */
  const monthsWithData = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => s.add(r.date.slice(0, 7)));
    return Array.from(s).sort();
  }, [rows]);

  const [month, setMonth] = useState('');
  const selectedMonth = month || monthsWithData[monthsWithData.length - 1] || '';

  /* Xếp hạng khách hàng theo Pmax trong tháng chọn */
  const ranking = useMemo<RankRow[]>(() => {
    if (!selectedMonth) return [];

    // meterNo -> đỉnh trong tháng (giá trị + ngày đạt)
    const peakByMeter = new Map<string, { pmax: number; date: string }>();
    for (const r of rows) {
      if (`${r.year}-${p2(r.monthIdx + 1)}` !== selectedMonth) continue;
      const cur = peakByMeter.get(r.meter);
      if (!cur || r.pmax > cur.pmax) peakByMeter.set(r.meter, { pmax: r.pmax, date: r.date });
    }

    const out: RankRow[] = [];
    for (const c of loadCustomers) {
      let best: RankRow | null = null;
      for (const m of c.meters) {
        const peak = peakByMeter.get(m.meterNo);
        if (!peak) continue;
        if (!best || peak.pmax > best.pmax) {
          best = {
            id: c.id, mkh: c.mkh, name: c.name,
            pmax: peak.pmax, date: peak.date,
            meterNo: m.meterNo, line: m.line,
            meterCount: c.meters.length,
          };
        }
      }
      if (best) out.push(best);
    }
    out.sort((a, b) => b.pmax - a.pmax);
    return out;
  }, [rows, loadCustomers, selectedMonth]);

  /* Pmax của (các) điểm đo đầu nguồn trong tháng — tính RIÊNG, không vào xếp hạng */
  const headPeak = useMemo(() => {
    if (!selectedMonth || headMeters.length === 0) return null;
    const set = new Set(headMeters.map(m => m.meterNo));
    let best: { pmax: number; date: string; meterNo: string } | null = null;
    for (const r of rows) {
      if (!set.has(r.meter)) continue;
      if (`${r.year}-${p2(r.monthIdx + 1)}` !== selectedMonth) continue;
      if (!best || r.pmax > best.pmax) best = { pmax: r.pmax, date: r.date, meterNo: r.meter };
    }
    if (!best) return null;
    const info = headMeters.find(m => m.meterNo === best!.meterNo);
    return { ...best, line: info?.line || '', name: info?.name || '' };
  }, [rows, headMeters, selectedMonth]);

  /* ---- 2 ô chọn khách hàng cho 2 biểu đồ Pmax theo ngày ----
     Mặc định = 2 khách có Pmax tháng lớn nhất; reset khi đổi tháng/phạm vi KCN. */
  const custOptions = useMemo(
    () => ranking.map(r => ({ value: r.id, label: `${r.name} · ${r.mkh}` })),
    [ranking],
  );

  const [slots, setSlots] = useState<[string, string]>(['', '']);
  const [slotKey, setSlotKey] = useState('');
  const defaultSlots = useMemo<[string, string]>(
    () => [ranking[0]?.id || '', ranking[1]?.id || ''],
    [ranking],
  );
  useEffect(() => {
    const key = `${selectedMonth}_${ranking.length}_${defaultSlots.join('|')}`;
    if (key !== slotKey) { setSlotKey(key); setSlots(defaultSlots); }
  }, [selectedMonth, ranking.length, defaultSlots, slotKey]);

  /* Pmax TỪNG NGÀY trong tháng của mỗi khách (max các công tơ trong ngày — cùng
     quy tắc "không cộng dồn" với bảng xếp hạng). customerId -> [{day, pmax}] */
  const dailyByCustomer = useMemo(() => {
    if (!selectedMonth) return new Map<string, { day: string; label: string; pmax: number }[]>();

    // meterNo -> date -> pmax (trong tháng đã chọn)
    const byMeter = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (`${r.year}-${p2(r.monthIdx + 1)}` !== selectedMonth) continue;
      let d = byMeter.get(r.meter);
      if (!d) { d = new Map(); byMeter.set(r.meter, d); }
      const cur = d.get(r.date);
      if (cur === undefined || r.pmax > cur) d.set(r.date, r.pmax);
    }

    const out = new Map<string, { day: string; label: string; pmax: number }[]>();
    for (const c of loadCustomers) {
      const perDay = new Map<string, number>();
      for (const m of c.meters) {
        const d = byMeter.get(m.meterNo);
        if (!d) continue;
        d.forEach((v, date) => {
          const cur = perDay.get(date);
          if (cur === undefined || v > cur) perDay.set(date, v);
        });
      }
      if (perDay.size === 0) continue;
      out.set(
        c.id,
        Array.from(perDay.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([day, pmax]) => ({ day, label: day.slice(8), pmax })),
      );
    }
    return out;
  }, [rows, loadCustomers, selectedMonth]);

  const maxRow = ranking[0];
  const avg = ranking.length ? ranking.reduce((s, r) => s + r.pmax, 0) / ranking.length : 0;
  const monthLabel = selectedMonth ? `${selectedMonth.slice(5)}/${selectedMonth.slice(0, 4)}` : '';

  /* ---- Render 1 biểu đồ Pmax theo ngày (cột, ngày đạt đỉnh tô màu rose như biểu đồ P) ---- */
  const renderDailyChart = (i: number) => {
    const selId = slots[i];
    const rank = ranking.find(r => r.id === selId);
    const data = selId ? dailyByCustomer.get(selId) ?? [] : [];
    const peak = data.reduce((m, d) => (d.pmax > m ? d.pmax : m), 0);

    return (
      <div key={i} className="rounded-[var(--radius)] border border-[var(--border)] p-4 bg-surface">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-soft">
            {i === 0 ? 'Pmax tháng cao nhất' : 'Pmax tháng cao thứ 2'}
          </span>
          {rank && (
            <span className="text-[11px] font-semibold text-danger tabular-nums shrink-0">
              Pmax {fmtKw(rank.pmax)} kW · {fmtDateVN(rank.date)}
            </span>
          )}
        </div>

        <Select
          value={selId}
          onChange={v => setSlots(prev => (i === 0 ? [v, prev[1]] : [prev[0], v]))}
          options={custOptions}
          searchable
          className="w-full mb-3"
        />

        <div className="h-[300px]">
          {data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  stroke="var(--text-4)"
                  style={{ fontSize: 10 }}
                  interval={0}
                  minTickGap={0}
                />
                <YAxis
                  tickFormatter={fmtKw}
                  tickLine={false}
                  axisLine={false}
                  stroke="var(--text-4)"
                  width={56}
                  style={{ fontSize: 10 }}
                  label={{
                    value: 'Pmax (kW)', angle: -90, position: 'insideLeft', offset: 8,
                    style: { fill: 'var(--text-4)', fontSize: 10, textAnchor: 'middle' },
                  }}
                />
                <Tooltip
                  cursor={{ fill: 'var(--accent-soft)' }}
                  content={<ChartTooltip fmt={v => `${fmtKw(v)} kW`} />}
                  labelFormatter={(l: string) => `Ngày ${l}/${monthLabel}`}
                />
                <Bar dataKey="pmax" name="Pmax" radius={[2, 2, 0, 0]} maxBarSize={16}>
                  {data.map((d, idx) => (
                    <Cell key={idx} fill={d.pmax === peak ? '#f43f5e' : CHART.accent} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={HelpCircle}
              title={selId ? 'Khách hàng này không có Pmax trong tháng' : 'Vui lòng chọn khách hàng'}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">

      {/* ---- Bộ chọn tháng ---- */}
      <div className="vl-card p-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Pmax khách hàng theo tháng</h2>
          <p className="text-sm text-soft mt-1 max-w-2xl">
            Pmax của khách hàng = giá trị lớn nhất của một công tơ trong tháng
            (không cộng dồn các điểm đo). Nguồn dữ liệu: <code>pmax_daily.csv</code>.
            {headMeters.length > 0 && (
              <> Điểm đo đầu nguồn <strong>{headMeters.map(m => m.line).join(', ')}</strong> đo tổng
              toàn KCN nên được <strong>tách riêng</strong>, không tính vào xếp hạng khách hàng.</>
            )}
          </p>
        </div>
        <div className="shrink-0">
          <MonthPicker
            value={selectedMonth}
            onChange={setMonth}
            label="Tháng"
            className="w-[200px]"
          />
          {monthsWithData.length > 0 && (
            <p className="text-[11px] text-faint mt-1.5 font-medium">
              Có dữ liệu: {monthsWithData[0]} – {monthsWithData[monthsWithData.length - 1]}
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-faint">
          <Gauge className="w-12 h-12 mb-3 animate-pulse opacity-40" />
          <p className="font-semibold">Đang tải dữ liệu Pmax…</p>
        </div>
      )}

      {!loading && error && (
        <div className="vl-card p-6">
          <EmptyState icon={HelpCircle} title="Không tải được dữ liệu Pmax" hint={error} />
        </div>
      )}

      {!loading && !error && ranking.length === 0 && (
        <div className="vl-card p-6">
          <EmptyState
            icon={HelpCircle}
            title="Không có dữ liệu Pmax trong tháng đã chọn"
            hint="Chọn tháng khác, hoặc khách hàng thuộc KCN của bạn chưa có công tơ trong pmax_daily.csv."
          />
        </div>
      )}

      {!loading && !error && ranking.length > 0 && (
        <>
          {/* ---- Ô số liệu (đầu nguồn tính riêng, chỉ hiện khi KCN có điểm đo đó) ---- */}
          <div className={`grid grid-cols-1 gap-4 ${headPeak ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
            {headPeak && (
              <StatTile
                label={`Đầu nguồn ${headPeak.line}`}
                value={fmtKw(headPeak.pmax)}
                unit="kW"
                sub={`Tính riêng · ${fmtDateVN(headPeak.date)} · CT ${headPeak.meterNo}`}
                subTone="warn"
                icon={Zap}
                tone="warn"
              />
            )}
            <StatTile
              label="Khách hàng có dữ liệu"
              value={ranking.length}
              unit="KH"
              icon={Users}
              tone="neutral"
            />
            <StatTile
              label="Pmax cao nhất"
              value={fmtKw(maxRow.pmax)}
              unit="kW"
              sub={`${maxRow.name} · ${fmtDateVN(maxRow.date)}`}
              icon={TrendingUp}
              tone="bad"
            />
            <StatTile
              label="Pmax trung bình"
              value={fmtKw(avg)}
              unit="kW"
              icon={Gauge}
              tone="accent"
            />
          </div>

          {/* ---- Card 2 biểu đồ: Pmax từng ngày trong tháng của 2 khách hàng ---- */}
          <div className="vl-card p-5">
            <h3 className="text-sm font-bold text-ink mb-4 uppercase tracking-wide">
              Pmax theo ngày — tháng {monthLabel}
            </h3>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {[0, 1].map(i => renderDailyChart(i))}
            </div>
          </div>

          {/* ---- Bảng xếp hạng đầy đủ ---- */}
          <div className="vl-card p-5">
            <h3 className="text-sm font-bold text-ink mb-4 uppercase tracking-wide">
              Xếp hạng Pmax tháng {monthLabel}
            </h3>
            <div className="overflow-x-auto">
              <table className="vl-table w-full border-collapse text-left" style={{ minWidth: 820 }}>
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="w-14">Hạng</th>
                    <th className="w-32">Mã KH</th>
                    <th>Tên khách hàng</th>
                    <th>Trạm / công tơ đạt đỉnh</th>
                    <th className="text-right w-32">Pmax (kW)</th>
                    <th className="w-32">Ngày đạt đỉnh</th>
                    <th className="text-right w-24">Số công tơ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {ranking.map((r, i) => (
                    <tr key={r.id}>
                      <td className="tabular-nums font-semibold text-soft">{i + 1}</td>
                      <td className="font-semibold">{r.mkh}</td>
                      <td>{r.name}</td>
                      <td className="text-soft">
                        {r.line || '—'}
                        <span className="block text-[11px] text-faint tabular-nums">{r.meterNo}</span>
                      </td>
                      <td className="text-right tabular-nums font-semibold text-ink">{fmtKw(r.pmax)}</td>
                      <td className="tabular-nums">{fmtDateVN(r.date)}</td>
                      <td className="text-right tabular-nums">{r.meterCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
