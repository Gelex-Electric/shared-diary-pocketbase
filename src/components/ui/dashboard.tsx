/* Shared dashboard primitives — control-room instrument tiles, panels,
   and a theme-aware recharts tooltip. Used by both summary dashboards. */
import React from 'react';
import type { LucideIcon } from 'lucide-react';

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
