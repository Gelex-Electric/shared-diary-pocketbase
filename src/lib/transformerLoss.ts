/**
 * Reader cho dữ liệu tổn thất máy biến áp (kỹ thuật) do GitHub Action sinh ra:
 *   - collection PB `tloss_daily`   : MỘT dòng/trạm/ngày — NGUỒN SỐ LIỆU báo cáo.
 *       OUTPUT lấy theo hiệu chỉ số công tơ × HSN (chính xác); LOSS tích phân ΔP.
 *       (Đã di trú từ transformer_loss_daily.csv sang PocketBase — Task 1.)
 *   - /transformer_loss_30min.csv   : mốc 30 phút (OUTPUT=P×Δt) — chỉ để VẼ biểu đồ trong ngày.
 *   - /transformer_loss_monthly.csv : tổn thất theo tháng theo trạm (lưu vĩnh viễn).
 *
 * Trạm = CODE (1 máy biến áp). Công thức ở scripts/daily_transformer_loss.py:
 *   S = √(P² + Q²); ΔP = P0 + Pk×(S/Sdm)²; LOSS = Σ ΔP×Δt.
 * File có thể chưa tồn tại (chưa nhập mba_info.csv) → coi như rỗng, không báo lỗi.
 */
import { fetchAll } from './pbData';

export interface LossDailyRow {
  code: string;
  lineName: string;
  date: string;           // YYYY-MM-DD
  outputKwh: number;      // sản lượng = Σ(chỉ số cuối−đầu)×HSN (hoặc fallback P×Δt)
  noloadKwh: number;
  loadKwh: number;
  lossKwh: number;
  lossPct: number;        // %
  maxLoadPct: number;     // %
  avgLoadPct: number;     // %
  nIntervals: number;
  outputSrc: string;      // 'index' | 'pxdt'
}

export interface LossMonthlyRow {
  code: string;
  lineName: string;
  month: string;          // YYYY-MM
  nDays: number;
  outputKwh: number;
  noloadKwh: number;
  loadKwh: number;
  totalKwh: number;
}

export interface Loss30minRow {
  code: string;
  lineName: string;
  dateTime: string;       // "YYYY-MM-DD HH:mm:ss"
  date: string;           // "YYYY-MM-DD"
  time: string;           // "HH:mm"
  durH: number;           // độ dài khoảng (giờ)
  nMeters: number;
  p: number;              // kW
  q: number;              // kvar
  s: number;              // kVA
  loadPct: number;        // %
  deltaP: number;         // kW
  outputKwh: number;      // sản lượng khoảng = P·dt
  noloadKwh: number;
  loadKwh: number;
  lossKwh: number;
}

function splitCsv(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter(l => l.trim().length > 0)
    .map(l => l.split(','));
}

const num = (v: string | undefined): number => {
  const n = parseFloat((v ?? '').trim());
  return isNaN(n) ? 0 : n;
};

async function fetchText(path: string): Promise<string | null> {
  const res = await fetch(path, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Không tải được ${path} (HTTP ${res.status})`);
  return res.text();
}

/** Ánh xạ header → index để đọc theo tên cột (bền với việc đổi thứ tự). */
function headerIndex(rows: string[][]): Record<string, number> {
  const idx: Record<string, number> = {};
  (rows[0] || []).forEach((h, i) => { idx[h.trim()] = i; });
  return idx;
}

export async function fetchLossMonthly(): Promise<LossMonthlyRow[]> {
  const text = await fetchText('/transformer_loss_monthly.csv');
  if (!text) return [];
  const rows = splitCsv(text);
  if (rows.length <= 1) return [];
  const h = headerIndex(rows);
  const out: LossMonthlyRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i];
    const code = (c[h['CODE']] ?? '').trim();
    if (!code) continue;
    out.push({
      code,
      lineName: (c[h['LINE_NAME']] ?? '').trim(),
      month: (c[h['MONTH']] ?? '').trim(),
      nDays: num(c[h['N_DAYS']]),
      outputKwh: num(c[h['OUTPUT_KWH']]),
      noloadKwh: num(c[h['LOSS_NOLOAD_KWH']]),
      loadKwh: num(c[h['LOSS_LOAD_KWH']]),
      totalKwh: num(c[h['LOSS_TOTAL_KWH']]),
    });
  }
  return out;
}

/** Bản ghi thô từ collection PB `tloss_daily` (tên field viết thường). */
interface TlossDailyRecord {
  code?: string;
  line_name?: string;
  date?: string;
  output_kwh?: number;
  loss_noload_kwh?: number;
  loss_load_kwh?: number;
  loss_kwh?: number;
  loss_pct?: number;
  max_load_pct?: number;
  avg_load_pct?: number;
  n_intervals?: number;
  output_src?: string;
}

/**
 * Đọc tổn thất theo trạm/ngày từ collection PocketBase `tloss_daily`
 * (thay cho transformer_loss_daily.csv — Task 1). Yêu cầu đã đăng nhập.
 */
export async function fetchLossDaily(): Promise<LossDailyRow[]> {
  const items = await fetchAll<TlossDailyRecord>('tloss_daily');
  const out: LossDailyRow[] = [];
  for (const r of items) {
    const code = (r.code ?? '').trim();
    const date = (r.date ?? '').trim();
    if (!code || !date) continue;
    out.push({
      code,
      lineName: (r.line_name ?? '').trim(),
      date,
      outputKwh: r.output_kwh ?? 0,
      noloadKwh: r.loss_noload_kwh ?? 0,
      loadKwh: r.loss_load_kwh ?? 0,
      lossKwh: r.loss_kwh ?? 0,
      lossPct: r.loss_pct ?? 0,
      maxLoadPct: r.max_load_pct ?? 0,
      avgLoadPct: r.avg_load_pct ?? 0,
      nIntervals: r.n_intervals ?? 0,
      outputSrc: (r.output_src ?? '').trim(),
    });
  }
  return out;
}

export async function fetchLoss30min(): Promise<Loss30minRow[]> {
  const text = await fetchText('/transformer_loss_30min.csv');
  if (!text) return [];
  const rows = splitCsv(text);
  if (rows.length <= 1) return [];
  const h = headerIndex(rows);
  const out: Loss30minRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i];
    const code = (c[h['CODE']] ?? '').trim();
    const dt = (c[h['DATE_TIME']] ?? '').trim();
    if (!code || !dt) continue;
    out.push({
      code,
      lineName: (c[h['LINE_NAME']] ?? '').trim(),
      dateTime: dt,
      date: dt.slice(0, 10),
      time: dt.slice(11, 16),
      durH: num(c[h['DUR_H']]),
      nMeters: num(c[h['N_METERS']]),
      p: num(c[h['P_KW']]),
      q: num(c[h['Q_KVAR']]),
      s: num(c[h['S_KVA']]),
      loadPct: num(c[h['LOAD_PCT']]),
      deltaP: num(c[h['DELTA_P_KW']]),
      outputKwh: num(c[h['OUTPUT_KWH']]),
      noloadKwh: num(c[h['LOSS_NOLOAD_KWH']]),
      loadKwh: num(c[h['LOSS_LOAD_KWH']]),
      lossKwh: num(c[h['LOSS_KWH']]),
    });
  }
  return out;
}
