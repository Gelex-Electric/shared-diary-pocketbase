/**
 * Đọc `public/head_balance_daily.csv` — đối soát điểm đo ĐẦU NGUỒN ↔ tổng các điểm đo
 * chính cùng lộ, mỗi ngày một dòng (sinh bởi `scripts/head_balance_daily.mjs`, bước 4c
 * của pipeline; lưu vĩnh viễn).
 *
 * Cùng khuôn với `pmaxLine.ts`: tải MỘT lần mỗi phiên, kiểm tiêu đề cột thay vì tin
 * `res.ok` (file vắng thì dev server trả HTML kèm 200).
 */
import { useEffect, useState } from 'react';

export interface HeadBalanceRow {
  head: string;
  line: string;
  /** Tên KCN (vd "KCN Thuận Thành I") — rỗng ở file cũ chưa có cột. */
  zone: string;
  date: string;
  eHead: number;
  eSum: number;
  loss: number;
  /** null = không tính được (đầu nguồn 0 kWh). */
  lossPct: number | null;
  pmaxHead: number | null;
  atHead: string;
  pmaxLine: number | null;
  atLine: string;
  pmaxRatio: number | null;
  covered: number;
  withData: number;
  total: number;
  /** Số mốc 30' của đầu nguồn; `partial` = thiếu file hôm sau (tính lại đêm sau). */
  headSlots: number;
  partial: boolean;
}

let _cache: HeadBalanceRow[] | null = null;
let _promise: Promise<HeadBalanceRow[]> | null = null;

const num = (s?: string) => { const v = parseFloat(s ?? ''); return Number.isFinite(v) ? v : null; };

function parse(text: string): HeadBalanceRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const head = lines[0].split(',');
  const at = (k: string) => head.indexOf(k);
  return lines.slice(1).map(l => {
    const c = l.split(',');
    const g = (k: string) => (c[at(k)] ?? '').trim();
    return {
      head: g('HEAD_CODE'), line: g('LINE_CODE'), zone: at('ZONE') >= 0 ? g('ZONE') : '', date: g('DATE'),
      eHead: num(g('E_HEAD_KWH')) ?? 0, eSum: num(g('E_SUM_KWH')) ?? 0, loss: num(g('LOSS_KWH')) ?? 0,
      lossPct: num(g('LOSS_PCT')),
      pmaxHead: num(g('PMAX_HEAD_KW')), atHead: g('AT_HEAD'),
      pmaxLine: num(g('PMAX_LINE_KW')), atLine: g('AT_LINE'),
      pmaxRatio: num(g('PMAX_RATIO')),
      covered: Number(g('COVERED')) || 0, withData: Number(g('WITH_DATA')) || 0, total: Number(g('TOTAL')) || 0,
      headSlots: parseInt(g('HEAD_SLOTS'), 10) || 0,
      partial: g('HEAD_SLOTS').endsWith('*'),
    };
  }).filter(r => r.head && r.date);
}

export function loadHeadBalance(): Promise<HeadBalanceRow[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = fetch('/head_balance_daily.csv', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then(t => {
      if (!t.startsWith('HEAD_CODE,')) throw new Error('Không phải file head_balance_daily.csv');
      _cache = parse(t);
      return _cache;
    })
    .catch(err => { _promise = null; throw err; });
  return _promise;
}

export function useHeadBalance() {
  const [rows, setRows] = useState<HeadBalanceRow[]>(_cache ?? []);
  const [loading, setLoading] = useState(_cache === null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (_cache) return;
    let mounted = true;
    loadHeadBalance()
      .then(r => { if (mounted) { setRows(r); setLoading(false); } })
      .catch(e => {
        if (mounted) { setError(e?.message || 'Không tải được head_balance_daily.csv'); setLoading(false); }
      });
    return () => { mounted = false; };
  }, []);
  return { rows, loading, error };
}
