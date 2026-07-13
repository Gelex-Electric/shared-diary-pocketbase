/* Shared dashboard primitives — control-room instrument tiles, panels,
   and a theme-aware recharts tooltip. Used by both summary dashboards. */
import React, { Fragment } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  type LucideIcon, ChevronDown, ChevronRight, Building2,
  ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import { fmtInt } from '../../lib/invoices';

/* Chart palette — bound to design tokens so it adapts light/dark.
   Categorical hues for tariffs stay literal (distinct + readable both modes). */
export const CHART = {
  accent: 'var(--accent)',
  bt: 'var(--accent)',   // bình thường
  cd: '#f59e0b',          // cao điểm (amber)
  td: '#22b8c4',          // thấp điểm (teal)
  vc: '#a78bfa',          // vô công (violet)
  ok: 'var(--success)',
  bad: 'var(--danger)',
};
export const ZONE_BARS = ['var(--accent)', '#22b8c4', '#f59e0b', '#a78bfa', '#34d399'];

type Tone = 'accent' | 'ok' | 'warn' | 'bad' | 'neutral';
const RAIL: Record<Tone, string> = {
  accent: 'var(--accent)',
  ok: 'var(--success)',
  warn: 'var(--warning)',
  bad: 'var(--danger)',
  neutral: 'var(--text-4)',
};
const LAMP: Record<Tone, string> = {
  accent: '', ok: 'on', warn: 'warn', bad: 'trip', neutral: 'off',
};

export function StatTile({
  label, value, unit, sub, subTone = 'neutral', tone = 'accent', icon: Icon, loading,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  subTone?: Tone;
  tone?: Tone;
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <div
      className="bg-surface border border-[var(--border)] rounded-[var(--radius)] p-4 flex flex-col gap-2.5"
      style={{ borderLeft: `3px solid ${RAIL[tone]}`, boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2">
        <span className={`vl-lamp ${LAMP[tone]}`} />
        <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-soft flex-1 min-w-0 truncate">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-faint shrink-0" />}
      </div>
      {loading ? (
        <div className="h-8 w-2/3 rounded bg-subtle animate-pulse" />
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className="text-[1.75rem] leading-none font-semibold text-ink tabular-nums tracking-tight">{value}</span>
          {unit && <span className="text-sm text-soft font-medium">{unit}</span>}
        </div>
      )}
      {sub != null && (
        <div className="text-xs font-medium tabular-nums" style={{ color: RAIL[subTone] }}>{sub}</div>
      )}
    </div>
  );
}

export function Panel({
  title, sub, icon: Icon, actions, children, className = '',
}: {
  title: string;
  sub?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-surface border border-[var(--border)] rounded-[var(--radius)] overflow-hidden ${className}`} style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
        {Icon && (
          <div className="p-2 rounded-lg bg-accent-soft shrink-0">
            <Icon className="w-4 h-4 text-accent" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-ink truncate">{title}</h3>
          {sub && <p className="text-[11px] text-faint mt-0.5 truncate">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/* Recharts tooltip — uses the tokenized .vl-chart-tooltip styling. */
export function ChartTooltip({
  active, payload, label, fmt,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  fmt?: (v: number, name?: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const f = fmt || ((v: number) => new Intl.NumberFormat('vi-VN').format(v));
  return (
    <div className="vl-chart-tooltip">
      {label != null && <div className="vl-chart-tooltip-title">{label}</div>}
      {payload.map((p, i) => (
        <div className="vl-chart-tooltip-row" key={i}>
          <span className="vl-dot" style={{ background: p.color || p.fill || p.stroke }} />
          <span className="vl-lbl">{p.name}</span>
          <span className="vl-val">{f(Number(p.value) || 0, p.name)}</span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
      <Icon className="w-10 h-10 text-faint" />
      <p className="text-sm font-semibold text-dim">{title}</p>
      {hint && <p className="text-xs text-faint max-w-xs">{hint}</p>}
    </div>
  );
}

/* Mũi tên tăng/giảm % — dùng cho mọi cột "Thay đổi" trong bảng. */
export function DeltaBadge({ d }: { d: number | null }) {
  const up = d != null && d > 0.0005, down = d != null && d < -0.0005;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums ${up ? 'text-ok' : down ? 'text-bad' : 'text-faint'}`}>
      <Icon className="w-3.5 h-3.5" />{d == null ? '—' : `${Math.abs(d * 100).toFixed(1)}%`}
    </span>
  );
}

export interface ZoneMeterRow {
  sct: string;
  addr: string;
  curKwh: number;
  curVnd: number;
  delta: number | null;
}
export interface ZoneCustomerRow {
  mkh: string;
  name: string;
  curKwh: number;
  curVnd: number;
  delta: number | null;
  meterList: ZoneMeterRow[];
  /** Sản lượng theo khung giờ (kWh) — chỉ dùng khi bảng bật showTariff. */
  bt?: number;
  cd?: number;
  td?: number;
}

/* Màu 3 khung giờ — trùng donut "Cơ cấu phụ tải theo khung giờ". */
const TARIFF_SEG = [
  { key: 'bt', color: 'var(--accent)', label: 'BT' },
  { key: 'cd', color: '#f59e0b', label: 'CĐ' },
  { key: 'td', color: '#22b8c4', label: 'TĐ' },
] as const;

/** Thanh bar ngang xếp chồng % sản lượng theo 3 khung giờ (BT/CĐ/TĐ), có số % làm tròn. */
export function TariffBar({ bt = 0, cd = 0, td = 0 }: { bt?: number; cd?: number; td?: number }) {
  const total = bt + cd + td;
  if (total <= 0) return <span className="text-faint text-xs">—</span>;
  const vals: Record<string, number> = { bt, cd, td };
  const title = TARIFF_SEG.map(s => `${s.label} ${Math.round((vals[s.key] / total) * 100)}%`).join(' · ');
  return (
    <div className="flex h-5 w-full min-w-[150px] rounded-md overflow-hidden bg-subtle" title={title}>
      {TARIFF_SEG.map(s => {
        const p = (vals[s.key] / total) * 100;
        if (p <= 0) return null;
        return (
          <div key={s.key} style={{ width: `${p}%`, background: s.color }}
            className="flex items-center justify-center text-[10px] font-bold text-white tabular-nums leading-none">
            {p >= 12 ? `${Math.round(p)}%` : ''}
          </div>
        );
      })}
    </div>
  );
}

/**
 * CustomerZoneCard — thẻ khách hàng theo khu vực (gradient header thu gọn được +
 * bảng có dòng con chi tiết công tơ + dòng tổng cộng).
 *
 * Đây là UI pattern chuẩn cho MỌI accordion nhóm-khách-hàng trong app — nhân bản
 * từ CustomerDebtManager.tsx. Xem tài liệu: .interface-design/pattern-zone-customer-card.md
 */
export function CustomerZoneCard({
  icon: Icon = Building2,
  title,
  subtitle,
  kwh,
  vnd,
  rows,
  collapsed,
  onToggleCollapse,
  expandedRows,
  onToggleRow,
  emptyLabel = 'Không có dữ liệu',
  showTariff = false,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  kwh: number;
  vnd: number;
  rows: ZoneCustomerRow[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  expandedRows: Record<string, boolean>;
  onToggleRow: (mkh: string) => void;
  emptyLabel?: string;
  /** Bật cột "Cơ cấu khung giờ" (thanh bar BT/CĐ/TĐ). */
  showTariff?: boolean;
}) {
  const nCols = showTariff ? 5 : 4;
  const tot = showTariff
    ? rows.reduce((a, r) => ({ bt: a.bt + (r.bt || 0), cd: a.cd + (r.cd || 0), td: a.td + (r.td || 0) }), { bt: 0, cd: 0, td: 0 })
    : { bt: 0, cd: 0, td: 0 };
  return (
    <div className="vl-card overflow-hidden">
      {/* Header — gradient accent, bấm để thu gọn/mở */}
      <div
        onClick={onToggleCollapse}
        className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] px-5 md:px-7 py-4 flex items-center justify-between gap-3 cursor-pointer select-none"
      >
        <div className="flex items-center gap-3 text-white min-w-0">
          <div className="p-2 bg-white/20 rounded-xl shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-black tracking-tight leading-tight truncate">{title}</h3>
            {subtitle && <p className="text-[11px] font-semibold text-white/80">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right hidden sm:block leading-tight">
            <div className="text-xs font-bold text-white tabular-nums">{fmtInt(kwh)} <span className="font-normal text-white/70">kWh</span></div>
            <div className="text-xs font-bold text-white tabular-nums">{fmtInt(vnd)} <span className="font-normal text-white/70">đ</span></div>
          </div>
          <ChevronDown className={`w-5 h-5 text-white transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
        </div>
      </div>

      {/* Body — đóng/mở có animation chiều cao */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="overflow-x-auto">
              <table className="vl-table w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                    <th className="py-3.5 px-4">Khách hàng</th>
                    <th className="py-3.5 px-4 text-right border-l border-[var(--border)] text-ink">Sản lượng (kWh)</th>
                    <th className="py-3.5 px-4 text-center">Thay đổi</th>
                    <th className="py-3.5 px-4 text-right">Doanh thu (đồng)</th>
                    {showTariff && (
                      <th className="py-3.5 px-4 text-center border-l border-[var(--border)]">
                        <div>Cơ cấu khung giờ</div>
                        <div className="flex items-center justify-center gap-2 mt-1 font-normal normal-case text-[9px] text-faint">
                          {TARIFF_SEG.map(s => (
                            <span key={s.key} className="inline-flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label}
                            </span>
                          ))}
                        </div>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.length === 0 ? (
                    <tr><td colSpan={nCols} className="py-10 text-center text-faint text-sm italic">{emptyLabel}</td></tr>
                  ) : rows.map(r => {
                    const open = !!expandedRows[r.mkh];
                    return (
                      <Fragment key={r.mkh}>
                        <tr
                          onClick={() => onToggleRow(r.mkh)}
                          className={`transition-colors cursor-pointer ${open ? 'bg-accent-soft/50' : 'hover:bg-subtle'}`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="flex items-start gap-2">
                              <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 transition-transform ${open ? 'rotate-90 text-accent' : 'text-faint'}`} />
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-ink break-words">{r.name}</div>
                                <div className="text-[11px] text-faint font-mono">{r.mkh} · {r.meterList.length} công tơ</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right text-sm font-bold text-ink tabular-nums border-l border-[var(--border)]">{fmtInt(r.curKwh)}</td>
                          <td className="py-3.5 px-4 text-center"><DeltaBadge d={r.delta} /></td>
                          <td className="py-3.5 px-4 text-right text-sm text-dim tabular-nums">{fmtInt(r.curVnd)}</td>
                          {showTariff && (
                            <td className="py-3.5 px-4 border-l border-[var(--border)]"><TariffBar bt={r.bt} cd={r.cd} td={r.td} /></td>
                          )}
                        </tr>
                        {open && r.meterList.map((m, mi) => (
                          <tr
                            key={r.mkh + '|' + m.sct}
                            className={`text-xs border-l-[3px] border-l-accent/40 bg-accent-soft/10 hover:bg-accent-soft/20 transition-colors ${mi === r.meterList.length - 1 ? 'border-b-2 border-b-[var(--border-strong)]' : ''}`}
                          >
                            <td className="py-3 px-4 pl-9">
                              <div className="flex flex-col">
                                <span className="font-mono font-semibold text-dim">CT {m.sct}</span>
                                {m.addr && <span className="text-[10px] text-faint truncate max-w-[240px]">{m.addr}</span>}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-dim tabular-nums border-l border-[var(--border)]">{fmtInt(m.curKwh)}</td>
                            <td className="py-3 px-4 text-center"><DeltaBadge d={m.delta} /></td>
                            <td className="py-3 px-4 text-right text-soft tabular-nums">{fmtInt(m.curVnd)}</td>
                            {showTariff && <td className="border-l border-[var(--border)]" />}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-surface border-t-2 border-[var(--border-strong)] text-sm font-black text-ink">
                      <td className="py-3.5 px-4 text-right uppercase text-xs tracking-wider text-dim">Tổng cộng</td>
                      <td className="py-3.5 px-4 text-right tabular-nums border-l border-[var(--border)]">{fmtInt(kwh)}</td>
                      <td className="py-3.5 px-4" />
                      <td className="py-3.5 px-4 text-right tabular-nums text-accent">{fmtInt(vnd)}</td>
                      {showTariff && (
                        <td className="py-3.5 px-4 border-l border-[var(--border)]"><TariffBar bt={tot.bt} cd={tot.cd} td={tot.td} /></td>
                      )}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
