# Design System — GETC Control Room

App: electric-grid operations control for industrial zones (PocketBase + React 19 + Vite + Tailwind v4).
Two roles share the same system: Vận hành (operations) and Kinh doanh (business).

## Direction
Personality: **Control room / instrument-grade**. 24/7 substation operations.
Feel: dense, precise, status-forward — reads like a SCADA HMI, not a generic admin template.
Rejected defaults: gradient-blue stat cards → flat instrument tiles with a status accent rail;
drop-shadow "Voler" cards → borders-first depth; size-only hierarchy → weight + tabular hero numbers.

## Modes
Dual-mode, runtime toggle. `data-theme="light" | "dark"` on `<html>`.
- Light = instrument panel (cool slate canvas `#eaeef3`, white surfaces).
- Dark = control room (charcoal `#0b1018`, panels `#0f1620`).
Infra: `src/lib/theme.ts` (initTheme/useTheme, persists to `localStorage` key `getc-theme`,
defaults to OS `prefers-color-scheme`). Toggle: `src/components/ui/ThemeToggle.tsx`, in both navbars.
`initTheme()` runs in `main.tsx` before render to avoid FOUC.

## Depth strategy
**Borders-first.** Light mode: hairline border + whisper shadow (`--shadow-card`).
Dark mode: shadows don't read → borders/rings only (`--shadow-card` collapses to a 1px ring).
Floating panels (dropdowns, popovers) always get an explicit `border` + `--shadow-pop` so they
separate from the surface in dark.

## Tokens (defined in src/index.css)
All semantic, dual-mode. Surfaces: `--bg`, `--surface-1..3`, `--surface-inset` (inputs).
Text — 4 levels: `--text-1` primary, `--text-2` secondary, `--text-3` meta, `--text-4` muted.
Borders: `--border`, `--border-strong`, `--focus-ring`.
Accent (single, intentional): `--accent`, `--accent-hover`, `--accent-soft`, `--on-accent`.
Status: `--success`/`--warning`/`--danger`/`--info` (+ `-soft` tint variants).
Status lamps (energized indicator dot): `--lamp-on|warn|off|trip`, `--lamp-glow`.
Geometry: `--radius-sm 6` / `--radius 8` / `--radius-lg 12`; `--sidebar-w 260px`.
Legacy `--vl-*` names are kept as aliases mapping onto the above (old `.vl-*` classes still work).

## Tailwind bridge
`@theme inline` maps tokens to utilities so components use semantic classes:
`bg-canvas|surface|raised|subtle|inset`, `text-ink|dim|soft|faint`, `text/bg-accent`,
`bg-accent-soft`, `text-ok|warn|bad|info`, `border-hair|hair-strong`.
For one-offs use bracket form `bg-[var(--border)]`, `text-[var(--text-3)]`, etc.

## Patterns
- Stat tile (`.vl-stat-card`): flat surface, `border-left: 3px` accent rail, NOT a gradient.
- Status lamp (`.vl-lamp.on|warn|off|trip`): 8px dot, soft glow on energized states.
- Card (`.vl-card`): surface-1 + hairline border + `--shadow-card`, radius 8.
- Buttons (`.vl-btn-*`): radius 6, `:active` scale(0.98), accent uses `--accent-hover` on hover.
- Tables (`.vl-table`): uppercase 0.72rem tracked headers, row hover `--surface-3`, tabular nums.
- Numbers: hero metrics use weight 500–600 + `tabular-nums`, unit in `--text-3` at ~14px.
- Charts (recharts): grid `stroke="var(--surface-inset)"`, axes `var(--text-3|4)`; series keep
  distinct saturated hues (phase A = accent, B green, C amber). Tooltip = `.vl-chart-tooltip` (tokened).

## Conventions
- No raw neutral/brand hex in components — bind to tokens. Saturated chart-series hues are the
  only literal colors allowed.
- One accent only; gray builds structure, color communicates (status/action).
- Keep one hue per surface; shift lightness, not hue, across elevation.

## Build
`npm install` then `npm run build` / `npm run lint` (tsc --noEmit). Dev: `npm run dev` (tsx server.ts).
