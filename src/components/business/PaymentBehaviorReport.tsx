import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, ThumbsUp, Clock, AlertTriangle, Search, FileSpreadsheet, ArrowUpDown } from 'lucide-react';
import { StatTile } from '../ui/dashboard';

/* ============================================================
   Báo cáo thói quen thanh toán của khách hàng (tab "Báo cáo" trang Công nợ).
   - Một hóa đơn (kỳ) "đúng hạn" khi trả trong ≤ ON_TIME_DAYS ngày kể từ ngày chốt.
   - Hóa đơn CHƯA trả mà đã quá hạn → tính là chậm (đang trễ); chưa trả nhưng còn
     trong hạn → bỏ qua (chưa đánh giá được).
   - Xếp loại theo % đúng hạn trên các hóa đơn đã đánh giá trong năm đang chọn:
     Luôn đúng hạn 100% · Thường đúng hạn ≥75% · Hay chậm 25–74% · Luôn chậm <25%.
============================================================ */

export const ON_TIME_DAYS = 5;
const LATE_DAYS = 7; // mốc đỏ — chỉ để tô màu chấm từng kỳ

/** Hình dạng tối thiểu cần từ dữ liệu công nợ (CustomerGroup tương thích cấu trúc). */
export interface BehaviorCustomer {
  mkh: string;
  nMua: string;
  kyList: { key: string; endDate: string; nTToan: string; dtVAT: number }[];
}

type Grade = 'always' | 'mostly' | 'often' | 'late';

const GRADE: Record<Grade, { label: string; badge: string; tone: 'ok' | 'accent' | 'warn' | 'bad'; icon: typeof CheckCircle2 }> = {
  always: { label: 'Luôn đúng hạn', badge: 'vl-badge-success', tone: 'ok', icon: CheckCircle2 },
  mostly: { label: 'Thường đúng hạn', badge: 'vl-badge-primary', tone: 'accent', icon: ThumbsUp },
  often: { label: 'Hay chậm', badge: 'vl-badge-warning', tone: 'warn', icon: Clock },
  late: { label: 'Luôn chậm', badge: 'vl-badge-danger', tone: 'bad', icon: AlertTriangle },
};
const GRADE_ORDER: Grade[] = ['always', 'mostly', 'often', 'late'];

/** Số ngày giữa 2 ngày YYYY-MM-DD (b − a), tính theo UTC để không lệch múi giờ. */
const diffDays = (a: string, b: string) => {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = (s: string) => { const [y, m, d] = s.split('-'); return d ? `${d}/${m}/${y}` : s; };
const fmtVND = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n);

interface KyEval { endDate: string; days: number; paid: boolean; onTime: boolean }
interface Row {
  mkh: string;
  nMua: string;
  evals: KyEval[];       // các kỳ đã đánh giá, cũ → mới
  onTime: number;
  late: number;
  pct: number;           // % đúng hạn
  avgDays: number | null; // TB số ngày trả (chỉ kỳ đã trả)
  maxDays: number;       // trễ nhiều nhất (kể cả kỳ đang trễ)
  owing: number;         // tiền đang trễ (chưa trả, đã quá hạn)
  grade: Grade;
}

type SortKey = 'pct' | 'avg' | 'max' | 'mkh';

export default function PaymentBehaviorReport({
  customers, year, loading,
}: { customers: BehaviorCustomer[]; year: string; loading: boolean }) {
  const [gradeFilter, setGradeFilter] = useState<Grade | ''>('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'pct', asc: true });

  const rows = useMemo<Row[]>(() => {
    const today = todayISO();
    const out: Row[] = [];
    customers.forEach(c => {
      const evals: KyEval[] = [];
      let owing = 0;
      c.kyList.forEach(ky => {
        if (!ky.endDate) return;
        if (ky.nTToan) {
          const days = diffDays(ky.endDate, ky.nTToan.slice(0, 10));
          evals.push({ endDate: ky.endDate, days, paid: true, onTime: days <= ON_TIME_DAYS });
        } else {
          const days = diffDays(ky.endDate, today);
          if (days > ON_TIME_DAYS) {           // chưa trả & đã quá hạn → chậm
            evals.push({ endDate: ky.endDate, days, paid: false, onTime: false });
            owing += ky.dtVAT;
          }                                    // còn trong hạn → chưa đánh giá
        }
      });
      if (evals.length === 0) return;
      evals.sort((a, b) => a.endDate.localeCompare(b.endDate));
      const onTime = evals.filter(e => e.onTime).length;
      const pct = (onTime / evals.length) * 100;
      const paidDays = evals.filter(e => e.paid).map(e => e.days);
      const grade: Grade = pct >= 100 ? 'always' : pct >= 75 ? 'mostly' : pct >= 25 ? 'often' : 'late';
      out.push({
        mkh: c.mkh, nMua: c.nMua, evals, onTime, late: evals.length - onTime, pct,
        avgDays: paidDays.length ? paidDays.reduce((s, d) => s + d, 0) / paidDays.length : null,
        maxDays: Math.max(...evals.map(e => e.days)),
        owing, grade,
      });
    });
    return out;
  }, [customers]);

  const counts = useMemo(() => {
    const m: Record<Grade, number> = { always: 0, mostly: 0, often: 0, late: 0 };
    rows.forEach(r => { m[r.grade] += 1; });
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter(r =>
      (!gradeFilter || r.grade === gradeFilter)
      && (!q || r.mkh.toLowerCase().includes(q) || r.nMua.toLowerCase().includes(q)));
    const dir = sort.asc ? 1 : -1;
    const val = (r: Row) =>
      sort.key === 'pct' ? r.pct : sort.key === 'avg' ? (r.avgDays ?? r.maxDays) : sort.key === 'max' ? r.maxDays : 0;
    return list.sort((a, b) =>
      sort.key === 'mkh'
        ? dir * a.mkh.localeCompare(b.mkh, 'vi')
        : dir * (val(a) - val(b)) || b.maxDays - a.maxDays || a.mkh.localeCompare(b.mkh, 'vi'));
  }, [rows, gradeFilter, search, sort]);

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === 'pct' || key === 'mkh' }));

  const SortTh = ({ k, children, className = '' }: { k: SortKey; children: ReactNode; className?: string }) => (
    <th className={`py-2.5 px-4 ${className}`}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase hover:text-dim">
        {children}
        <ArrowUpDown className={`w-3 h-3 ${sort.key === k ? 'text-accent' : 'opacity-40'}`} />
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      {/* Card đếm theo xếp loại — bấm để lọc bảng */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {GRADE_ORDER.map(g => {
          const G = GRADE[g];
          const active = gradeFilter === g;
          return (
            <button
              key={g}
              onClick={() => setGradeFilter(active ? '' : g)}
              className={`text-left rounded-[var(--radius)] transition-all ${active ? 'ring-2 ring-[var(--accent)]' : 'hover:-translate-y-0.5'}`}
              title={active ? 'Bỏ lọc' : `Chỉ xem khách hàng "${G.label}"`}
            >
              <StatTile
                label={G.label}
                value={counts[g]}
                unit="khách hàng"
                tone={G.tone}
                icon={G.icon}
                loading={loading}
                sub={rows.length ? `${Math.round((counts[g] / rows.length) * 100)}% số khách đã đánh giá` : undefined}
                subTone={G.tone}
              />
            </button>
          );
        })}
      </div>

      <div className="vl-card overflow-hidden">
        <div className="px-5 md:px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--border)]">
          <div>
            <h3 className="text-sm font-black text-ink uppercase tracking-wide">Thói quen thanh toán — năm {year}</h3>
            <p className="text-[11px] font-semibold text-soft">
              Đúng hạn = trả trong ≤ {ON_TIME_DAYS} ngày kể từ ngày chốt chỉ số. Hóa đơn chưa trả mà đã quá hạn tính là chậm;
              còn trong hạn thì chưa đánh giá.
            </p>
          </div>
          <div className="relative shrink-0">
            <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm MKH, tên công ty..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-[var(--border)] bg-surface rounded-lg text-dim text-sm focus:outline-none focus:ring-1 focus:ring-accent w-full md:w-[240px]"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-faint text-sm">Đang tải dữ liệu năm {year}...</div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-faint flex flex-col items-center">
            <FileSpreadsheet className="w-10 h-10 mb-2" />
            <p className="text-sm">Không có khách hàng nào khớp bộ lọc</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="vl-table w-full text-left border-collapse table-fixed min-w-[980px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider">
                  <SortTh k="mkh" className="w-[11%]">Mã KH</SortTh>
                  <th className="py-2.5 px-4 w-[22%]">Tên doanh nghiệp</th>
                  <th className="py-2.5 px-4 w-[9%] text-center">Đúng / Đã xét</th>
                  <SortTh k="pct" className="w-[10%] text-center">% đúng hạn</SortTh>
                  <SortTh k="avg" className="w-[10%] text-center">Trả TB</SortTh>
                  <SortTh k="max" className="w-[10%] text-center">Trễ nhất</SortTh>
                  <th className="py-2.5 px-4 w-[14%]">Từng kỳ (cũ → mới)</th>
                  <th className="py-2.5 px-4 w-[14%] text-right">Xếp loại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {shown.map(r => {
                  const G = GRADE[r.grade];
                  return (
                    <tr key={r.mkh} className="text-sm">
                      <td className="py-2.5 px-4 font-mono text-[11px] font-bold text-soft">{r.mkh}</td>
                      <td className="py-2.5 px-4 text-ink font-semibold leading-snug">
                        {r.nMua || '(Chưa có tên)'}
                        {r.owing > 0 && (
                          <div className="text-[10px] font-bold text-rose-600 font-mono mt-0.5">Đang trễ {fmtVND(r.owing)} đ</div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono text-xs">
                        <span className="font-bold text-ink">{r.onTime}</span>
                        <span className="text-faint">/{r.evals.length}</span>
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono text-xs font-bold text-ink">{Math.round(r.pct)}%</td>
                      <td className="py-2.5 px-4 text-center font-mono text-xs text-soft">
                        {r.avgDays == null ? '—' : `${r.avgDays.toFixed(1)} ngày`}
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono text-xs">
                        <span className={r.maxDays > LATE_DAYS ? 'text-rose-600 font-bold' : r.maxDays > ON_TIME_DAYS ? 'text-warn font-bold' : 'text-soft'}>
                          {r.maxDays} ngày
                        </span>
                      </td>
                      {/* Dãy chấm: mỗi chấm 1 kỳ — xanh đúng hạn, vàng chậm ≤7 ngày, đỏ >7 ngày; viền rỗng = chưa trả */}
                      <td className="py-2.5 px-4">
                        <div className="flex flex-wrap gap-1">
                          {r.evals.map((e, i) => {
                            const color = e.onTime ? 'var(--success)' : e.days > LATE_DAYS ? 'var(--danger)' : 'var(--warning)';
                            return (
                              <span
                                key={`${e.endDate}-${i}`}
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={e.paid ? { background: color } : { border: `2px solid ${color}` }}
                                title={`Kỳ ${fmtDate(e.endDate)}: ${e.paid ? `trả sau ${e.days} ngày` : `chưa trả, đã ${e.days} ngày`}`}
                              />
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className={`${G.badge} inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold`}>
                          <G.icon className="w-3.5 h-3.5" /> {G.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
