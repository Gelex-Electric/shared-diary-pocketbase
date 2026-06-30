/* ============================================================
   Invoice data layer — shared by the operations & business dashboards.
   Source of truth: PocketBase collection `invoice` (per meter, per period).

   One physical "invoice" (kỳ chốt chỉ số) can be split into several
   records when a price change happens mid-period; they share a BillId /
   IndexId. We merge those back into one bill before aggregating, mirroring
   CustomerDebtManager / BillConfirmManager.

   Active energy (hữu công):  TongSL_HC (kWh)  / ThTien_HC (VND)
   Reactive energy (vô công): TongSL_PK (kVarh)/ ThTien_PK (VND)
   Tariff split (kWh):        SL_BT (bình thường) / SL_CD (cao điểm) / SL_TD (thấp điểm)
   Power factor:              CosFi
   Zone:                      prefix of MKHang  (e.g. "KCNTH-002" → "KCNTH")
   Payment date:              NTToan  (empty = chưa thu)
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { pb } from './pocketbase';

export interface InvoiceRecord {
  id: string;
  MKHang: string;
  NMua: string;
  SCT?: string;
  StartDate?: string;
  EndDate: string;
  IndexId?: string;
  BillId?: string;
  NTToan?: string;
  LoaiHD?: string;
  HSN?: number;
  [key: string]: any;
}

/* One merged bill (a customer's period, price-change splits folded in). */
export interface Bill {
  key: string;
  mkh: string;
  nMua: string;
  zone: string;
  endDate: string;   // YYYY-MM-DD
  month: string;     // YYYY-MM
  year: number;
  ids: string[];
  slHC: number;      // kWh
  slVC: number;      // kVarh
  dtHC: number;      // VND
  dtVC: number;      // VND
  slBT: number;      // kWh bình thường
  slCD: number;      // kWh cao điểm
  slTD: number;      // kWh thấp điểm
  cosFi: number;     // representative power factor
  paid: boolean;
}

/* ── Zones ─────────────────────────────────────────────── */
export const ZONE_MAP: Record<string, string> = {
  KCNTH: 'KCN Tiền Hải',
  KCNPĐ: 'KCN Phong Điền',
  KCNTTI: 'KCN Thuận Thành I',
  KCNYM: 'KCN Yên Mỹ',
  KCN03: 'KCN Số 3',
};
export const ZONE_ORDER = Object.keys(ZONE_MAP);
export const zoneOf = (mkh: string) => (mkh.split('-')[0] || '').trim();

/** Map a user's `area` (free text) to a zone code, or '' for all (admin). */
export function zoneFromArea(area?: string): string {
  const n = (area || '').toLowerCase();
  if (!n.trim()) return '';
  if (n.includes('tiền hải')   || n.includes('kcnth')) return 'KCNTH';
  if (n.includes('phong điền') || n.includes('kcnpđ') || n.includes('kcnpd')) return 'KCNPĐ';
  if (n.includes('thuận thành')|| n.includes('kcntti')) return 'KCNTTI';
  if (n.includes('yên mỹ')     || n.includes('kcnym')) return 'KCNYM';
  if (n.includes('số 3')       || n.includes('kcn03')) return 'KCN03';
  return '';
}

/* ── Formatting ────────────────────────────────────────── */
export const num = (v: any) => {
  const n = parseFloat((v ?? '').toString().replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const fmtInt = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n);
export const fmtKWh = (n: number) => fmtInt(n) + ' kWh';
export const fmtVND = (n: number) => fmtInt(n) + ' ₫';
/** Compact VND for hero tiles: 1.2 tỷ / 340 tr / 12.000. */
export function fmtVNDShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ';
  if (a >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
  return fmtInt(n);
}
export function fmtKWhShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' GWh';
  if (a >= 1e3) return (n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' MWh';
  return fmtInt(n);
}
const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];
export const fmtDate = (s?: string) => {
  const d = dateOnly(s);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return dd && m && y ? `${dd}/${m}/${y}` : d;
};
const pad2 = (n: number) => String(n).padStart(2, '0');

/* ── Merge price-change splits into bills ──────────────── */
export function mergeBills(records: InvoiceRecord[]): Bill[] {
  const map = new Map<string, Bill>();
  const fold = (key: string, r: InvoiceRecord) => {
    const end = dateOnly(r.EndDate);
    const month = end.slice(0, 7);
    let b = map.get(key);
    if (!b) {
      b = {
        key, mkh: (r.MKHang || '').trim(), nMua: r.NMua || '', zone: zoneOf((r.MKHang || '').trim()),
        endDate: end, month, year: Number(end.slice(0, 4)) || 0, ids: [],
        slHC: 0, slVC: 0, dtHC: 0, dtVC: 0, slBT: 0, slCD: 0, slTD: 0, cosFi: 0, paid: false,
      };
      map.set(key, b);
    }
    b.ids.push(r.id);
    b.slHC += num(r.TongSL_HC);
    b.slVC += num(r.TongSL_PK);
    b.dtHC += num(r.ThTien_HC);
    b.dtVC += num(r.ThTien_PK);
    b.slBT += num(r.SL_BT);
    b.slCD += num(r.SL_CD);
    b.slTD += num(r.SL_TD);
    const cf = num(r.CosFi);
    if (cf > 0) b.cosFi = b.cosFi ? Math.min(b.cosFi, cf) : cf;
    if (end > b.endDate) { b.endDate = end; b.month = month; b.year = Number(end.slice(0, 4)) || b.year; }
    if (dateOnly(r.NTToan)) b.paid = true;
  };

  records.forEach(r => {
    const mkh = (r.MKHang || '').trim();
    const end = dateOnly(r.EndDate);
    if (!mkh || !end) return;
    const loai = (r.LoaiHD || '').trim();
    const billId = (r.BillId ?? '').toString().trim();
    const indexId = (r.IndexId ?? '').toString().trim();
    if (billId && billId !== '0')       fold(`${mkh}|${loai}|B:${billId}`, r);
    else if (indexId && indexId !== '0') fold(`${mkh}|${loai}|I:${indexId}`, r);
    else                                 fold(`${mkh}|${loai}|${(r.SCT || '').trim()}|${end}`, r);
  });

  return Array.from(map.values());
}

/* ── Aggregations ──────────────────────────────────────── */
export interface MonthPoint { month: string; label: string; kwh: number; vnd: number; bills: number; }

/** Monthly series across the loaded window, chronological. */
export function monthlySeries(bills: Bill[]): MonthPoint[] {
  const m = new Map<string, MonthPoint>();
  bills.forEach(b => {
    if (!b.month) return;
    let p = m.get(b.month);
    if (!p) { p = { month: b.month, label: b.month.slice(5) + '/' + b.month.slice(0, 4), kwh: 0, vnd: 0, bills: 0 }; m.set(b.month, p); }
    p.kwh += b.slHC; p.vnd += b.dtHC + b.dtVC; p.bills += 1;
  });
  return Array.from(m.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export interface TariffSplit { bt: number; cd: number; td: number; }
export function tariffSplit(bills: Bill[]): TariffSplit {
  return bills.reduce((a, b) => ({ bt: a.bt + b.slBT, cd: a.cd + b.slCD, td: a.td + b.slTD }), { bt: 0, cd: 0, td: 0 });
}

export interface CustomerRollup {
  mkh: string; nMua: string; zone: string;
  kwh: number; vnd: number; vndPaid: number; vndDebt: number; bills: number; unpaid: number;
}
export function rollupByCustomer(bills: Bill[]): CustomerRollup[] {
  const m = new Map<string, CustomerRollup>();
  bills.forEach(b => {
    let c = m.get(b.mkh);
    if (!c) { c = { mkh: b.mkh, nMua: b.nMua, zone: b.zone, kwh: 0, vnd: 0, vndPaid: 0, vndDebt: 0, bills: 0, unpaid: 0 }; m.set(b.mkh, c); }
    const money = b.dtHC + b.dtVC;
    c.kwh += b.slHC; c.vnd += money; c.bills += 1;
    if (b.paid) c.vndPaid += money; else { c.vndDebt += money; c.unpaid += 1; }
    if (b.nMua && !c.nMua) c.nMua = b.nMua;
  });
  return Array.from(m.values());
}

export interface ZoneRollup {
  code: string; name: string;
  kwh: number; vnd: number; vndPaid: number; vndDebt: number; customers: number; unpaid: number;
}
export function rollupByZone(bills: Bill[]): ZoneRollup[] {
  const m = new Map<string, ZoneRollup>();
  const seen = new Map<string, Set<string>>();
  bills.forEach(b => {
    const code = b.zone || 'Khác';
    let z = m.get(code);
    if (!z) { z = { code, name: ZONE_MAP[code] || code, kwh: 0, vnd: 0, vndPaid: 0, vndDebt: 0, customers: 0, unpaid: 0 }; m.set(code, z); seen.set(code, new Set()); }
    const money = b.dtHC + b.dtVC;
    z.kwh += b.slHC; z.vnd += money;
    if (b.paid) z.vndPaid += money; else { z.vndDebt += money; z.unpaid += 1; }
    seen.get(code)!.add(b.mkh);
  });
  m.forEach((z, code) => { z.customers = seen.get(code)!.size; });
  return Array.from(m.values()).sort((a, b) => {
    const ia = ZONE_ORDER.indexOf(a.code), ib = ZONE_ORDER.indexOf(b.code);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

export interface Kpis {
  kwh: number; vnd: number; vndPaid: number; vndDebt: number;
  bills: number; unpaid: number; customers: number;
  collectRate: number;   // 0..1
  avgCosFi: number;      // kWh-weighted
  reactiveRatio: number; // kVarh / kWh
}
export function computeKpis(bills: Bill[]): Kpis {
  let kwh = 0, vnd = 0, vndPaid = 0, vndDebt = 0, unpaid = 0, kvarh = 0, cfNum = 0, cfDen = 0;
  const custs = new Set<string>();
  bills.forEach(b => {
    const money = b.dtHC + b.dtVC;
    kwh += b.slHC; vnd += money; kvarh += b.slVC; custs.add(b.mkh);
    if (b.paid) vndPaid += money; else { vndDebt += money; unpaid += 1; }
    if (b.cosFi > 0 && b.slHC > 0) { cfNum += b.cosFi * b.slHC; cfDen += b.slHC; }
  });
  return {
    kwh, vnd, vndPaid, vndDebt, bills: bills.length, unpaid, customers: custs.size,
    collectRate: vnd > 0 ? vndPaid / vnd : 0,
    avgCosFi: cfDen > 0 ? cfNum / cfDen : 0,
    reactiveRatio: kwh > 0 ? kvarh / kwh : 0,
  };
}

/* ── Hook: load a bounded multi-year window ────────────── */
export interface UseInvoicesOpts {
  /** Most-recent year to include (default: current year). */
  endYear?: number;
  /** How many years back to load for trend comparison (default: 2 → 3 years total). */
  yearsBack?: number;
  /** Lock to the signed-in user's zone (operations role). Admin/business: false. */
  lockToArea?: boolean;
}

export function useInvoices(opts: UseInvoicesOpts = {}) {
  const { endYear = new Date().getFullYear(), yearsBack = 2, lockToArea = false } = opts;
  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const zoneLock = useMemo(
    () => (lockToArea ? zoneFromArea(pb.authStore.model?.area) : ''),
    [lockToArea],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const startYear = endYear - yearsBack;
      const start = `${startYear}-01-01`;
      const nextStart = `${endYear + 1}-01-01`;
      const list = await pb.collection('invoice').getFullList<InvoiceRecord>({
        filter: pb.filter('EndDate >= {:start} && EndDate < {:nextStart}', { start, nextStart }),
        sort: '-EndDate',
        requestKey: null,
      });
      setRecords(list);
    } catch (err: any) {
      setError(err?.data?.message || err?.message || 'Không tải được dữ liệu hóa đơn');
    } finally {
      setLoading(false);
    }
  }, [endYear, yearsBack]);

  useEffect(() => { load(); }, [load]);

  const bills = useMemo(() => {
    const all = mergeBills(records);
    return zoneLock ? all.filter(b => b.zone === zoneLock) : all;
  }, [records, zoneLock]);

  /** SCT (công tơ) → khách hàng, suy từ các bản ghi đã tải (lọc theo khu vực nếu khoá). */
  const meterIndex = useMemo(() => {
    const m = new Map<string, { mkh: string; nMua: string; zone: string }>();
    records.forEach(r => {
      const sct = (r.SCT || '').trim();
      const mkh = (r.MKHang || '').trim();
      if (!sct || !mkh) return;
      const zone = zoneOf(mkh);
      if (zoneLock && zone !== zoneLock) return;
      const prev = m.get(sct);
      if (!prev || (!prev.nMua && r.NMua)) m.set(sct, { mkh, nMua: r.NMua || prev?.nMua || '', zone });
    });
    return m;
  }, [records, zoneLock]);

  return { bills, records, meterIndex, loading, error, reload: load, zoneLock };
}
