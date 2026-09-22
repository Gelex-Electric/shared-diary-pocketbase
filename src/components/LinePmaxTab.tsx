/**
 * Tab "Pmax theo lộ" của trang Đồ thị điện áp & công suất.
 *
 * MỘT LỘ MỘT BIỂU ĐỒ, trục hoành là các THÁNG (user chốt 22/09/2026) — không vẽ
 * Pmax ngày, và không phải bảng so các lộ với nhau trong một tháng.
 *
 * MỘT NGUỒN DUY NHẤT: `/pmax_line_daily.csv` — cộng công suất các trạm theo TỪNG
 * MỐC 30 phút rồi mới lấy max. Có từ 27/08/2026, tự dài thêm mỗi đêm.
 *
 * ĐÃ BỎ phần "ước lượng" cho giai đoạn trước đó (user chốt 22/09/2026). Nó dựng
 * từ `pmax_daily.csv` và lệch theo HAI hướng ngược nhau: cao hơn 10–34% vì cộng
 * các đỉnh không trùng giờ, nhưng lại thấp hơn ở tháng cũ vì hơn nửa số công tơ
 * chưa được treo khi đó. Hai thiên lệch chồng lên nhau thì con số không đọc ra
 * được điều gì đáng tin. Biểu đồ ngắn nhưng mọi cột cùng một thước đo.
 *
 * Nhờ bỏ ước lượng, màn này KHÔNG còn phải đọc danh mục PocketBase — chỉ cần
 * đúng một file CSV.
 */
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Bar, Cell,
} from 'recharts';
import { Cable, TrendingUp, Users, HelpCircle } from 'lucide-react';
import { usePmaxLineDaily } from '../lib/pmaxLine';
import type { LineMonthPoint } from '../lib/pmaxLine';
import { Select } from './ui/Select';
import { StatTile, EmptyState, CHART } from './ui/dashboard';

const p2 = (n: number) => String(n).padStart(2, '0');
const fmtKw = (n: number) => Math.round(n).toLocaleString('vi-VN');
const fmtDateVN = (k: string) => (k ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : '—');

/** Dưới ngưỡng này thì con số chưa đại diện cho cả lộ. */
const LOW_COVER = 0.8;

const COLOR_DO = CHART.accent;

function MonthTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r: LineMonthPoint = payload[0].payload;
  const low = r.total > 0 && r.covered / r.total < LOW_COVER;
  return (
    <div className="vl-chart-tooltip">
      <div className="vl-chart-tooltip-title">Tháng {r.label}</div>
      <div className="vl-chart-tooltip-group">
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Pmax</span>
          <span className="vl-val">{fmtKw(r.pmax)} kW</span>
        </div>
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Đạt ngày</span>
          <span className="vl-val">{fmtDateVN(r.date)}{r.at ? ` ${r.at}` : ''}</span>
        </div>
        {r.topName && (
          <div className="vl-chart-tooltip-row">
            <span className="vl-lbl">Khách kéo đỉnh</span>
            <span className="vl-val">{r.topName} · {fmtKw(r.topKw)} kW ({r.topShare}%)</span>
          </div>
        )}
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Công tơ có số liệu</span>
          <span className="vl-val">{r.covered}/{r.total}{low ? ' ⚠' : ''}</span>
        </div>
      </div>
    </div>
  );
}

export default function LinePmaxTab() {
  const { rows: lineRows, loading, error } = usePmaxLineDaily();

  /* Mã lộ lấy thẳng từ chính file số liệu — lộ chưa có số đo nào thì cũng chẳng
     có gì để vẽ, nên không cần đọc danh mục. */
  const lineCodes = useMemo(
    () => [...new Set(lineRows.map(r => r.line))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })),
    [lineRows]);

  const [picked, setPicked] = useState('');
  /*
    Mặc định lộ có phụ tải lớn nhất — mở ra là thấy ngay cái đáng xem.

    useMemo phải gọi VÔ ĐIỀU KIỆN. Viết `picked || useMemo(...)` thì `||` ngắn
    mạch, hook chỉ chạy khi chưa chọn lộ — đổi lộ một lần là số hook thay đổi
    giữa hai lần render và React vỡ.
  */
  const defaultLine = useMemo(() => {
    let best = '';
    let mx = -1;
    for (const r of lineRows) if (r.pmax > mx) { mx = r.pmax; best = r.line; }
    return best || lineCodes[0] || '';
  }, [lineRows, lineCodes]);
  const current = picked || defaultLine;

  /* --------- Đỉnh của từng THÁNG: ngày có đỉnh cao nhất trong tháng --------- */
  const series = useMemo<LineMonthPoint[]>(() => {
    if (!current) return [];
    const byMonth = new Map<string, LineMonthPoint>();
    for (const r of lineRows) {
      if (r.line !== current) continue;
      const m = `${r.year}-${p2(r.monthIdx + 1)}`;
      const cur = byMonth.get(m);
      if (!cur || r.pmax > cur.pmax) {
        byMonth.set(m, {
          month: m, label: `${p2(r.monthIdx + 1)}/${r.year}`, pmax: r.pmax,
          date: r.date, at: r.at, covered: r.covered, total: r.total,
          topMkh: r.topMkh, topName: r.topName, topStation: r.topStation,
          topKw: r.topKw, topShare: r.topShare,
        });
      }
    }
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [current, lineRows]);

  const peak = series.reduce<LineMonthPoint | null>((a, b) => (!a || b.pmax > a.pmax ? b : a), null);
  const lastMeasured = series[series.length - 1];
  const lowCover = lastMeasured && lastMeasured.total > 0
    && lastMeasured.covered / lastMeasured.total < LOW_COVER;

  if (error) {
    return <div className="vl-alert vl-alert-light-danger">Không đọc được số liệu: {error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* ---- Đầu trang + chọn lộ ---- */}
      <div className="vl-card flex flex-col justify-between gap-4 p-5 md:flex-row md:items-end">
        <div>
          <h2 className="text-lg font-bold text-ink">Pmax theo lộ đường dây</h2>
          <p className="mt-1 max-w-3xl text-sm text-soft">
            Đỉnh phụ tải của cả lộ theo từng tháng. Số <b>đo được</b> cộng công suất các
            trạm theo <b>từng mốc 30 phút</b> rồi mới lấy giá trị lớn nhất — không phải
            tổng các Pmax trạm, vì các trạm đạt đỉnh khác giờ nhau.
          </p>
        </div>
        <div className="shrink-0">
          <Select value={current} onChange={setPicked}
            options={lineCodes.map(c => ({ value: c, label: c }))}
            label="Lộ đường dây" placeholder="Chọn lộ" searchable className="w-[220px]" />
        </div>
      </div>

      {loading ? (
        <div className="vl-card flex items-center justify-center py-20 text-faint">Đang tải…</div>
      ) : series.length === 0 ? (
        <EmptyState icon={HelpCircle} title="Lộ này chưa có số liệu"
          hint="Chưa có công tơ nào trên lộ báo số, hoặc lộ chưa gắn trạm." />
      ) : (
        <>
          {/* ---- Thẻ tổng quan ---- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile label="Pmax cao nhất" value={peak ? fmtKw(peak.pmax) : '—'} unit="kW" icon={Cable}
              sub={peak ? `tháng ${peak.label}` : undefined} />
            <StatTile label="Tháng gần nhất"
              value={lastMeasured ? fmtKw(lastMeasured.pmax) : '—'} unit="kW" icon={TrendingUp}
              sub={lastMeasured
                ? `${lastMeasured.label} · ${fmtDateVN(lastMeasured.date)} lúc ${lastMeasured.at}`
                : 'chưa có tháng nào có số liệu'} />
            {/* Đỉnh của lộ là do AI — câu hỏi đầu tiên người vận hành hỏi khi
                thấy một con số Pmax cao. */}
            <StatTile
              label="Khách kéo đỉnh"
              value={lastMeasured?.topName || '—'}
              icon={Users}
              tone={lowCover ? 'warn' : 'neutral'}
              sub={lastMeasured?.topName
                ? `${fmtKw(lastMeasured.topKw)} kW · ${lastMeasured.topShare}% đỉnh lộ`
                  + ` · ${lastMeasured.covered}/${lastMeasured.total} công tơ`
                + (lowCover ? ' ⚠ chưa đại diện cả lộ' : '')
                : 'chưa có tháng nào đo được'}
            />
          </div>

          {/* ---- Biểu đồ ---- */}
          <div className="vl-card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-bold text-ink">Pmax lộ {current} theo tháng</h3>
              <span className="text-[11px] text-faint">
                Đỉnh trùng thời điểm · công suất trung bình 30 phút
              </span>
            </div>
            <ResponsiveContainer width="100%" height={330}>
              <BarChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
                <YAxis tick={{ fontSize: 11 }} width={62}
                  label={{ value: 'kW', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <Tooltip content={<MonthTooltip />} cursor={{ fill: 'var(--subtle)' }} />
                <Bar dataKey="pmax" name="Pmax" radius={[3, 3, 0, 0]} maxBarSize={56}>
                  {series.map((r, i) => (
                    /* Tháng thiếu công tơ tô khác màu — nhìn là thấy cột nào
                       chưa đại diện cả lộ, không phải rê chuột từng cột. */
                    <Cell key={i} fill={r.total > 0 && r.covered / r.total < LOW_COVER
                      ? 'var(--warning)' : COLOR_DO} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              Số liệu bắt đầu từ 27/08/2026 — trước đó không có dữ liệu 30 phút nên không
              tính được đỉnh trùng thời điểm. Mỗi đêm pipeline thêm một ngày, biểu đồ tự dài ra.
            </p>
          </div>

          {/* ---- Bảng chi tiết ---- */}
          <div className="vl-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-subtle text-faint">
                    <th className="px-4 py-2.5 text-left font-bold">Tháng</th>
                    <th className="px-4 py-2.5 text-right font-bold">Pmax (kW)</th>
                    <th className="px-4 py-2.5 text-left font-bold">Đạt lúc</th>
                    <th className="px-4 py-2.5 text-left font-bold">Khách kéo đỉnh</th>
                    <th className="px-4 py-2.5 text-left font-bold">Công tơ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series].reverse().map(r => {
                    const low = r.total > 0 && r.covered / r.total < LOW_COVER;
                    return (
                      <tr key={r.month} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2.5 font-mono font-bold text-ink">{r.label}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-ink">{fmtKw(r.pmax)}</td>
                        <td className="px-4 py-2.5 font-mono text-soft">
                          {fmtDateVN(r.date)}{r.at ? ` ${r.at}` : ''}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.topName ? (
                            <>
                              <span className="font-semibold text-ink">{r.topName}</span>
                              <span className="ml-1.5 text-[11px] text-faint">
                                {fmtKw(r.topKw)} kW · {r.topShare}%
                              </span>
                              <div className="text-[11px] text-faint">{r.topStation}</div>
                            </>
                          ) : <span className="text-faint italic">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={low ? 'font-bold text-[var(--warning)]' : 'text-soft'}>
                            {r.covered}/{r.total}
                            {low && ' — chưa đại diện cả lộ'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
