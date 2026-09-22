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
  /** Khách hàng đóng góp lớn nhất TẠI ĐÚNG MỐC đạt đỉnh. */
  topMkh: string;
  topName: string;
  topStation: string;
  topKw: number;
  /** Tỷ trọng của khách đó trong đỉnh, %. 70% nghĩa là đỉnh lộ thực chất là
   *  đỉnh của một khách; 15% là nhiều khách cùng lên. */
  topShare: number;
}

let _cache: PmaxLineRow[] | null = null;
let _promise: Promise<PmaxLineRow[]> | null = null;

function parse(text: string): PmaxLineRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const out: PmaxLineRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [code, date, pmax, at, covered, total, , topMkh, topName, topStation, topKw, topShare]
      = line.split(',');
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
      topMkh: (topMkh ?? '').trim(),
      topName: (topName ?? '').trim(),
      topStation: (topStation ?? '').trim(),
      topKw: parseFloat(topKw) || 0,
      topShare: Number(topShare) || 0,
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
  /** Khách kéo đỉnh lên — chỉ có ở tháng ĐO ĐƯỢC. */
  topMkh: string;
  topName: string;
  topStation: string;
  topKw: number;
  topShare: number;
}

/**
 * Ước lượng Pmax tháng của một lộ từ `pmax_daily.csv` (đỉnh TỪNG công tơ).
 *
 * Cách tính: mỗi NGÀY cộng đỉnh của các công tơ trên lộ, rồi lấy ngày lớn nhất
 * trong tháng. Cộng theo ngày chặt hơn cộng đỉnh-tháng-của-từng-công-tơ, vì ít
 * nhất các đỉnh được cộng phải rơi vào cùng một ngày.
 *
 * VẪN LÀ ƯỚC LƯỢNG, không phải số đo, và lệch theo HAI HƯỚNG NGƯỢC NHAU:
 *
 *   CAO HƠN vì đỉnh các trạm rơi vào giờ khác nhau mà vẫn bị cộng lại — đo trên
 *   tháng 9/2026 (tháng có cả hai nguồn) thì cao hơn số đo 10–34%, cả 9/9 lộ.
 *
 *   THẤP HƠN ở THÁNG CŨ vì tập công tơ là tập CỦA HÔM NAY: 41/79 công tơ mới
 *   treo trong năm 2026, nên tháng 1 chỉ có 7/14 công tơ của lộ 472E28.6 từng
 *   phát số liệu. Đường đi lên trên biểu đồ vì thế MỘT PHẦN chỉ là thêm trạm
 *   được đấu vào, không phải tải tăng.
 *
 * Vì thế hàm này trả kèm `covered` — số công tơ thực sự có số liệu trong tháng.
 * Không hiện con số đó thì người đọc sẽ tưởng mọi cột cùng một phạm vi.
 */
export function estimateMonthly(
  pmaxRows: { meter: string; date: string; year: number; monthIdx: number; pmax: number }[],
  serials: Set<string>,
  year: number,
  monthIdx: number,
): { pmax: number; date: string; covered: number } {
  const byDay = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of pmaxRows) {
    if (r.year !== year || r.monthIdx !== monthIdx) continue;
    if (!serials.has(r.meter)) continue;
    seen.add(r.meter);
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.pmax);
  }
  let pmax = 0;
  let date = '';
  for (const [d, v] of byDay) if (v > pmax) { pmax = v; date = d; }
  return { pmax, date, covered: seen.size };
}
