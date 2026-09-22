/**
 * Tab "Pmax theo lộ" của trang Đồ thị điện áp & công suất.
 *
 * MỘT LỘ MỘT BIỂU ĐỒ, trục hoành là các THÁNG (user chốt 22/09/2026) — không vẽ
 * Pmax ngày, và không phải bảng so các lộ với nhau trong một tháng.
 *
 * HAI NGUỒN, ghi rõ tháng nào là gì (user chốt 22/09/2026):
 *
 *   ĐO ĐƯỢC   từ `/pmax_line_daily.csv` — cộng công suất các trạm theo TỪNG MỐC
 *             30 phút rồi mới lấy max. Đây là đỉnh thật của lộ. Có từ 27/08/2026,
 *             và tự dài thêm mỗi đêm khi pipeline chạy.
 *   ƯỚC LƯỢNG từ `/pmax_daily.csv` — mỗi ngày cộng đỉnh từng công tơ rồi lấy
 *             ngày lớn nhất. Phủ được từ 01/2026 nhưng CAO HƠN đỉnh thật 10–33%
 *             (đo trên tháng 9, tháng có cả hai nguồn).
 *
 * Hai màu khác nhau và có chú giải — trộn hai loại số vào một dãy cột cùng màu
 * là mời người đọc so tháng 3 với tháng 9 như thể chúng cùng một thước đo.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Bar, Cell,
} from 'recharts';
import { Cable, TrendingUp, AlertTriangle, HelpCircle } from 'lucide-react';
import { usePmaxLineDaily, estimateMonthly } from '../lib/pmaxLine';
import type { LineMonthPoint } from '../lib/pmaxLine';
import { usePmaxDaily } from '../lib/pmax';
import { isAbortError, loadCatalog, pbErrorMessage } from '../lib/dm/repo';
import type { CatalogData } from '../lib/dm/repo';
import { lineMetersOf } from '../lib/dm/lineLoad';
import { Select } from './ui/Select';
import { StatTile, EmptyState, CHART } from './ui/dashboard';

const p2 = (n: number) => String(n).padStart(2, '0');
const fmtKw = (n: number) => Math.round(n).toLocaleString('vi-VN');
const fmtDateVN = (k: string) => (k ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : '—');

/** Dưới ngưỡng này thì con số chưa đại diện cho cả lộ. */
const LOW_COVER = 0.8;

const COLOR_DO = CHART.accent;
const COLOR_UOC = '#a78bfa';

function MonthTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r: LineMonthPoint = payload[0].payload;
  const low = r.src === 'do' && r.total > 0 && r.covered / r.total < LOW_COVER;
  return (
    <div className="vl-chart-tooltip">
      <div className="vl-chart-tooltip-title">Tháng {r.label}</div>
      <div className="vl-chart-tooltip-group">
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Pmax</span>
          <span className="vl-val">{fmtKw(r.pmax)} kW</span>
        </div>
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Nguồn</span>
          <span className="vl-val">{r.src === 'do' ? 'Đo được' : 'Ước lượng'}</span>
        </div>
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Đạt ngày</span>
          <span className="vl-val">{fmtDateVN(r.date)}{r.at ? ` ${r.at}` : ''}</span>
        </div>
        {r.src === 'do' && (
          <div className="vl-chart-tooltip-row">
            <span className="vl-lbl">Công tơ có số liệu</span>
            <span className="vl-val">{r.covered}/{r.total}{low ? ' ⚠' : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LinePmaxTab() {
  const { rows: lineRows, loading: loadingLine, error: errLine } = usePmaxLineDaily();
  const { rows: meterRows, loading: loadingMeter } = usePmaxDaily();

  /* Danh mục chỉ để biết lộ nào gồm công tơ nào — cần cho phần ước lượng. */
  const [cat, setCat] = useState<CatalogData | null>(null);
  const [errCat, setErrCat] = useState('');
  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then(d => { if (alive) setCat(d); })
      .catch(e => { if (alive && !isAbortError(e)) setErrCat(pbErrorMessage(e)); });
    return () => { alive = false; };
  }, []);

  /* Mã lộ → tập số công tơ ĐANG TREO ở điểm đo chính. */
  const serialsByCode = useMemo(() => {
    const out = new Map<string, Set<string>>();
    if (!cat) return out;
    const byId = lineMetersOf(cat);
    for (const l of cat.lines) out.set(l.code, new Set(byId.get(l.id) ?? []));
    return out;
  }, [cat]);

  const lineCodes = useMemo(
    () => (cat?.lines ?? []).map(l => l.code).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })),
    [cat]);

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

  /* --------- Dãy tháng của lộ đang chọn: ưu tiên số ĐO, thiếu thì ƯỚC LƯỢNG --------- */
  const series = useMemo<LineMonthPoint[]>(() => {
    if (!current) return [];
    const serials = serialsByCode.get(current) ?? new Set<string>();

    /* Tháng cần vẽ = hợp của hai nguồn. Chỉ lấy tháng mà lộ này thực sự có số,
       không dựng cột rỗng cho những tháng lộ chưa tồn tại. */
    const months = new Set<string>();
    for (const r of lineRows) if (r.line === current) months.add(`${r.year}-${p2(r.monthIdx + 1)}`);
    for (const r of meterRows) if (serials.has(r.meter)) months.add(`${r.year}-${p2(r.monthIdx + 1)}`);

    const out: LineMonthPoint[] = [];
    for (const m of [...months].sort()) {
      const [y, mm] = m.split('-').map(Number);
      const monthIdx = mm - 1;

      /* Số ĐO có thì dùng, không cần ngó tới ước lượng. */
      let best: LineMonthPoint | null = null;
      for (const r of lineRows) {
        if (r.line !== current || r.year !== y || r.monthIdx !== monthIdx) continue;
        if (!best || r.pmax > best.pmax) {
          best = {
            month: m, label: `${p2(mm)}/${y}`, pmax: r.pmax, src: 'do',
            date: r.date, at: r.at, covered: r.covered, total: r.total,
          };
        }
      }
      if (best) { out.push(best); continue; }

      const e = estimateMonthly(meterRows, serials, y, monthIdx);
      if (e.pmax > 0) {
        out.push({
          month: m, label: `${p2(mm)}/${y}`, pmax: e.pmax, src: 'uoc',
          date: e.date, at: '', covered: 0, total: serials.size,
        });
      }
    }
    return out;
  }, [current, lineRows, meterRows, serialsByCode]);

  const measured = series.filter(s => s.src === 'do');
  const peak = series.reduce<LineMonthPoint | null>((a, b) => (!a || b.pmax > a.pmax ? b : a), null);
  const lastMeasured = measured[measured.length - 1];
  const lowCover = lastMeasured && lastMeasured.total > 0
    && lastMeasured.covered / lastMeasured.total < LOW_COVER;

  const loading = loadingLine || loadingMeter || (!cat && !errCat);
  const error = errLine || errCat;

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
              sub={peak ? `tháng ${peak.label} · ${peak.src === 'do' ? 'đo được' : 'ước lượng'}` : undefined} />
            <StatTile label="Tháng gần nhất có số đo"
              value={lastMeasured ? fmtKw(lastMeasured.pmax) : '—'} unit="kW" icon={TrendingUp}
              sub={lastMeasured
                ? `${lastMeasured.label} · ${fmtDateVN(lastMeasured.date)} lúc ${lastMeasured.at}`
                : 'chưa có tháng nào đo được'} />
            <StatTile
              label="Công tơ có số liệu"
              value={lastMeasured ? `${lastMeasured.covered}/${lastMeasured.total}` : '—'}
              icon={AlertTriangle}
              tone={lowCover ? 'warn' : 'neutral'}
              sub={lowCover
                ? 'chưa đại diện cả lộ — còn trạm chưa báo số'
                : 'ở tháng gần nhất có số đo'}
            />
          </div>

          {/* ---- Biểu đồ ---- */}
          <div className="vl-card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-bold text-ink">Pmax lộ {current} theo tháng</h3>
              {/* Chú giải hai nguồn — đặt ngay cạnh tiêu đề, không giấu dưới đáy. */}
              <div className="flex items-center gap-4 text-[11px] text-soft">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_DO }} />
                  Đo được (30 phút)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_UOC }} />
                  Ước lượng — thường cao hơn 10–33%
                </span>
              </div>
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
                    <Cell key={i} fill={r.src === 'do' ? COLOR_DO : COLOR_UOC} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {measured.length > 0 && measured.length < series.length && (
              <p className="mt-2 text-[11px] text-faint">
                Số đo bắt đầu có từ tháng {measured[0].label}; các tháng trước đó là ước lượng
                cộng đỉnh từng công tơ nên cao hơn đỉnh thật. Mỗi đêm pipeline lại thêm một
                ngày số đo, nên phần tím sẽ lùi dần.
              </p>
            )}
          </div>

          {/* ---- Bảng chi tiết ---- */}
          <div className="vl-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-subtle text-faint">
                    <th className="px-4 py-2.5 text-left font-bold">Tháng</th>
                    <th className="px-4 py-2.5 text-right font-bold">Pmax (kW)</th>
                    <th className="px-4 py-2.5 text-left font-bold">Nguồn</th>
                    <th className="px-4 py-2.5 text-left font-bold">Đạt lúc</th>
                    <th className="px-4 py-2.5 text-left font-bold">Công tơ có số liệu</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series].reverse().map(r => {
                    const low = r.src === 'do' && r.total > 0 && r.covered / r.total < LOW_COVER;
                    return (
                      <tr key={r.month} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2.5 font-mono font-bold text-ink">{r.label}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-ink">{fmtKw(r.pmax)}</td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                            style={{
                              background: r.src === 'do' ? 'var(--accent-soft)' : '#a78bfa22',
                              color: r.src === 'do' ? 'var(--accent)' : '#7c5cd6',
                            }}>
                            {r.src === 'do' ? 'Đo được' : 'Ước lượng'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-soft">
                          {fmtDateVN(r.date)}{r.at ? ` ${r.at}` : ''}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.src === 'do' ? (
                            <span className={low ? 'font-bold text-[var(--warning)]' : 'text-soft'}>
                              {r.covered}/{r.total}{low && ' — chưa đại diện cả lộ'}
                            </span>
                          ) : (
                            <span className="text-faint italic">không áp dụng</span>
                          )}
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
