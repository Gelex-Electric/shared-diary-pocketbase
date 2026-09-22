/**
 * Pmax theo LỘ ĐƯỜNG DÂY — đọc `/pmax_line_daily.csv`.
 *
 * Cột: `LINE_CODE, DATE, PMAX_KW, AT, COVERED, TOTAL, SRC`.
 * File do `scripts/pmax_line_daily.mjs` sinh mỗi đêm trong pipeline.
 *
 * VÌ SAO KHÔNG TÍNH TỪ `pmax_daily.csv`: file đó là đỉnh của TỪNG CÔNG TƠ, cộng
 * lại là đỉnh KHÔNG TRÙNG THỜI ĐIỂM nên vống 0–25% (đo ngày 21/09/2026). Đỉnh
 * thật của lộ phải cộng công suất theo từng mốc 30 phút rồi mới lấy max — mà dữ
 * liệu 30 phút chỉ giữ 30 ngày, nên pipeline tính ngay mỗi đêm và lưu vĩnh viễn.
 *
 * ĐƠN VỊ KHÁC `pmax_daily.csv`: đây là công suất TRUNG BÌNH 30 phút, còn kia là
 * công suất TỨC THỜI (đo lệch ~18%). Đừng đem hai con số so thẳng với nhau.
 *
 * Cache ở mức module — tải một lần mỗi phiên, giống `lib/pmax.ts`.
 */
import { useEffect, useState } from 'react';

export interface PmaxLineRow {
  line: string;
  date: string;      // YYYY-MM-DD
  year: number;
  monthIdx: number;  // 0..11
  pmax: number;      // kW
  /** Giờ đạt đỉnh, `HH:mm`. */
  at: string;
  /** Số công tơ ĐANG TREO có số liệu / tổng số công tơ đang treo của lộ. */
  covered: number;
  total: number;
}

let _cache: PmaxLineRow[] | null = null;
let _promise: Promise<PmaxLineRow[]> | null = null;

function parse(text: string): PmaxLineRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const out: PmaxLineRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [code, date, pmax, at, covered, total] = line.split(',');
    if (!code || !date) continue;
    const year = Number(date.slice(0, 4));
    const monthIdx = Number(date.slice(5, 7)) - 1;
    if (!year || monthIdx < 0) continue;
    out.push({
      line: code.trim(), date: date.trim(), year, monthIdx,
      pmax: parseFloat(pmax) || 0,
      at: (at ?? '').trim(),
      covered: Number(covered) || 0,
      total: Number(total) || 0,
    });
  }
  return out;
}

export function loadPmaxLineDaily(): Promise<PmaxLineRow[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = fetch('/pmax_line_daily.csv')
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    /* File tĩnh vắng mặt thì dev server trả trang HTML kèm 200 — kiểm nội dung
       chứ không tin mỗi `res.ok`, không thì parse HTML ra 0 dòng mà không ai
       biết vì sao (đã gặp ngày 16/09/2026 với hes_30min). */
    .then(t => {
      if (!t.startsWith('LINE_CODE,')) throw new Error('Không phải file pmax_line_daily.csv');
      _cache = parse(t);
      return _cache;
    })
    .catch(err => { _promise = null; throw err; });
  return _promise;
}

export function usePmaxLineDaily() {
  const [rows, setRows] = useState<PmaxLineRow[]>(_cache ?? []);
  const [loading, setLoading] = useState(_cache === null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (_cache) return;
    let mounted = true;
    loadPmaxLineDaily()
      .then(r => { if (mounted) { setRows(r); setLoading(false); } })
      .catch(e => {
        if (mounted) { setError(e?.message || 'Không tải được pmax_line_daily.csv'); setLoading(false); }
      });
    return () => { mounted = false; };
  }, []);
  return { rows, loading, error };
}

/** Một lộ trong một tháng — đã gộp từ các ngày. */
export interface MonthlyLinePeak {
  line: string;
  pmax: number;
  /** Ngày đạt đỉnh trong tháng, `YYYY-MM-DD`. */
  date: string;
  at: string;
  /** Độ phủ TẠI NGÀY đạt đỉnh — con số đó mới là thứ đẻ ra Pmax đang hiện. */
  covered: number;
  total: number;
  /** Số ngày trong tháng có số liệu, để biết tháng này đầy hay khuyết. */
  days: number;
}

/**
 * Pmax tháng của từng lộ = ngày có đỉnh CAO NHẤT trong tháng.
 *
 * Lấy max các đỉnh NGÀY chứ không cộng: mỗi đỉnh ngày đã là đỉnh trùng thời
 * điểm của cả lộ rồi, đỉnh tháng chỉ là ngày nặng nhất trong số đó.
 *
 * `covered/total` lấy theo ĐÚNG NGÀY đạt đỉnh chứ không phải trung bình tháng:
 * người đọc cần biết con số đang hiện dựa trên mấy công tơ, mà đó là độ phủ của
 * chính ngày đó.
 */
export function monthlyPeaks(rows: PmaxLineRow[], year: number, monthIdx: number): MonthlyLinePeak[] {
  const byLine = new Map<string, MonthlyLinePeak>();
  for (const r of rows) {
    if (r.year !== year || r.monthIdx !== monthIdx) continue;
    const cur = byLine.get(r.line);
    if (!cur) {
      byLine.set(r.line, {
        line: r.line, pmax: r.pmax, date: r.date, at: r.at,
        covered: r.covered, total: r.total, days: 1,
      });
      continue;
    }
    cur.days++;
    if (r.pmax > cur.pmax) {
      cur.pmax = r.pmax; cur.date = r.date; cur.at = r.at;
      cur.covered = r.covered; cur.total = r.total;
    }
  }
  return [...byLine.values()].sort((a, b) => b.pmax - a.pmax);
}

/* ===================== Ước lượng cho tháng CHƯA có số liệu 30 phút ===================== */

/** Một tháng trên biểu đồ của MỘT lộ. */
export interface LineMonthPoint {
  /** `YYYY-MM`. */
  month: string;
  /** Nhãn trục hoành, `MM/YYYY`. */
  label: string;
  pmax: number;
  /**
   * `do` = tính từ dữ liệu 30 phút, đỉnh TRÙNG THỜI ĐIỂM — số đúng.
   * `uoc` = cộng đỉnh từng công tơ theo ngày rồi lấy ngày lớn nhất.
   */
  src: 'do' | 'uoc';
  date: string;
  at: string;
  covered: number;
  total: number;
}

/**
 * Ước lượng Pmax tháng của một lộ từ `pmax_daily.csv` (đỉnh TỪNG công tơ).
 *
 * Cách tính: mỗi NGÀY cộng đỉnh của các công tơ trên lộ, rồi lấy ngày lớn nhất
 * trong tháng. Cộng theo ngày chặt hơn cộng đỉnh-tháng-của-từng-công-tơ, vì ít
 * nhất các đỉnh được cộng phải rơi vào cùng một ngày.
 *
 * VẪN LÀ ƯỚC LƯỢNG, không phải số đo: đỉnh của các trạm trong ngày rơi vào giờ
 * khác nhau nên tổng này cao hơn đỉnh thật — đo trên tháng 9/2026 (tháng có cả
 * hai) thì cao hơn 10–33% ở 8/9 lộ.
 *
 * KHÔNG gọi nó là "cận trên": một lộ ra THẤP hơn số đo 2%, vì hai nguồn không
 * phủ cùng một tập công tơ. Nhãn đúng là "ước lượng", và màn hình phải ghi rõ
 * tháng nào là đo, tháng nào là ước lượng.
 */
export function estimateMonthly(
  pmaxRows: { meter: string; date: string; year: number; monthIdx: number; pmax: number }[],
  serials: Set<string>,
  year: number,
  monthIdx: number,
): { pmax: number; date: string } {
  const byDay = new Map<string, number>();
  for (const r of pmaxRows) {
    if (r.year !== year || r.monthIdx !== monthIdx) continue;
    if (!serials.has(r.meter)) continue;
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.pmax);
  }
  let pmax = 0;
  let date = '';
  for (const [d, v] of byDay) if (v > pmax) { pmax = v; date = d; }
  return { pmax, date };
}

/** Các tháng có số liệu, mới nhất trước — để đổ vào bộ chọn tháng. */
export function monthsOf(rows: PmaxLineRow[]): { year: number; monthIdx: number }[] {
  const seen = new Set<string>();
  const out: { year: number; monthIdx: number }[] = [];
  for (const r of rows) {
    const k = `${r.year}-${r.monthIdx}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ year: r.year, monthIdx: r.monthIdx });
  }
  return out.sort((a, b) => b.year - a.year || b.monthIdx - a.monthIdx);
}
