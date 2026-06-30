/* Pmax (công suất cực đại) daily data — read from /pmax_daily.csv.
   Columns: METER_NO, DATE (YYYY-MM-DD), PMAX_KW.
   Module-level cache so it loads once per session. */
import { useEffect, useState } from 'react';

export interface PmaxRow {
  meter: string;
  date: string;   // YYYY-MM-DD
  year: number;
  monthIdx: number; // 0..11
  pmax: number;
}

let _cache: PmaxRow[] | null = null;
let _promise: Promise<PmaxRow[]> | null = null;

function parse(text: string): PmaxRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const out: PmaxRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [meter, date, pmax] = line.split(',');
    if (!meter || !date) continue;
    const year = Number(date.slice(0, 4));
    const monthIdx = Number(date.slice(5, 7)) - 1;
    if (!year || monthIdx < 0) continue;
    out.push({ meter: meter.trim(), date: date.trim(), year, monthIdx, pmax: parseFloat(pmax) || 0 });
  }
  return out;
}

export function loadPmaxDaily(): Promise<PmaxRow[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = fetch('/pmax_daily.csv')
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then(t => { _cache = parse(t); return _cache; })
    .catch(err => { _promise = null; throw err; });
  return _promise;
}

export function usePmaxDaily() {
  const [rows, setRows] = useState<PmaxRow[]>(_cache ?? []);
  const [loading, setLoading] = useState(_cache === null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (_cache) return;
    let mounted = true;
    loadPmaxDaily()
      .then(r => { if (mounted) { setRows(r); setLoading(false); } })
      .catch(e => { if (mounted) { setError(e?.message || 'Không tải được pmax_daily.csv'); setLoading(false); } });
    return () => { mounted = false; };
  }, []);
  return { rows, loading, error };
}
