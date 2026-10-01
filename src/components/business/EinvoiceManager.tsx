/* ================================================================
   "Hóa đơn điện tử" — mục con Hồ sơ kinh doanh (plans/2026-10-01-trang-hoa-don-dien-tu.md).

   Mỗi dòng = một bản ghi `einvoice` (một hóa đơn = một XML đã nạp):
   - Xem hóa đơn (BILLPDF) / Xem giấy báo (NOTI): PDF tải từ CCIS qua server, KHÔNG lưu.
   - Cột "Email nhận" = email khách trong danh mục (`dm_customer.email`).

   Gửi email ĐÃ GỠ (01/10/2026): Railway gói Hobby chặn SMTP ra ngoài; user chuyển sang
   Power Automate. Mẫu thư + route gửi cũ còn trong git (commit 3405ee3, `server/mail.ts`).
================================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Receipt, KeyRound, RefreshCw, Search, FileText, MailQuestion, Mail } from 'lucide-react';
import { pb } from '../../lib/pocketbase';
import { MonthPicker } from '../ui/DateTimePickers';
import { Select } from '../ui/Select';
import { StatTile, EmptyState } from '../ui/dashboard';
import { ZoneSection } from './ZoneSection';
import { ZONE_MAP, zoneOf } from '../../lib/invoices';
import { openEinvoicePdf, requestBillval, type EinvoicePdfType } from '../../lib/einvoiceApi';
import { toast as notify } from '../../lib/toast';

interface EInvoiceRow {
  id: string;
  BillId: string;
  LoaiHD: string;
  Year: number; Month: number; Term: number;
  KHMSHDon: string; KHHDon: string; SHDon: string;
  MKHang: string; NMua: string; TgTTTBSo: number;
  billval?: string;
}

/** Không tải `xml` (toàn văn ~24 KB/hóa đơn). */
const FIELDS = 'id,BillId,LoaiHD,Year,Month,Term,KHMSHDon,KHHDon,SHDon,MKHang,NMua,TgTTTBSo,billval';

const EMAIL_OPTS = [
  { value: '', label: 'Mọi khách hàng' },
  { value: 'has', label: 'Khách đã có email' },
  { value: 'none', label: 'Khách chưa có email' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const money = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));

export default function EinvoiceManager() {
  const [ym, setYm] = useState('');
  const [rows, setRows] = useState<EInvoiceRow[]>([]);
  /** mkh → email trong danh mục. */
  const [emailOf, setEmailOf] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  /** `<id>|<NOTI|BILLPDF|BILLVAL>` đang chạy. */
  const [busy, setBusy] = useState('');

  const toast = useCallback((t: 'success' | 'error', title: string, msg: string) =>
    notify.show(t, title, msg, { duration: 6000 }), []);

  /* Mặc định = tháng mới nhất có hóa đơn đã nạp. */
  useEffect(() => {
    pb.collection('einvoice').getList<EInvoiceRow>(1, 1, { sort: '-Year,-Month', fields: 'Year,Month', requestKey: null })
      .then(r => {
        const e = r.items[0];
        const now = new Date();
        setYm(e ? `${e.Year}-${pad2(e.Month)}` : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
      })
      .catch(() => setLoading(false));
  }, []);

  const load = useCallback(async () => {
    if (!ym) return;
    setLoading(true);
    try {
      const [y, m] = ym.split('-').map(Number);
      const [list, customers] = await Promise.all([
        pb.collection('einvoice').getFullList<EInvoiceRow>({
          filter: pb.filter('Year = {:y} && Month = {:m}', { y, m }), sort: 'MKHang,SHDon', fields: FIELDS, requestKey: null,
        }),
        pb.collection('dm_customer').getFullList<{ mkh: string; email?: string }>({ fields: 'mkh,email', requestKey: null }),
      ]);
      setRows(list);
      setEmailOf(new Map(customers.map(c => [c.mkh, (c.email || '').trim()])));
    } catch (err: any) {
      toast('error', 'Lỗi', `Không tải được hóa đơn: ${err?.message || ''}`);
    } finally {
      setLoading(false);
    }
  }, [ym, toast]);
  useEffect(() => { void load(); }, [load]);

  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => rows.filter(e => {
    const hasEmail = !!emailOf.get(e.MKHang);
    if ((emailFilter === 'has' && !hasEmail) || (emailFilter === 'none' && hasEmail)) return false;
    const hay = `${e.MKHang} ${e.NMua} ${e.KHHDon}/${e.SHDon} ${Number(e.SHDon)}`.toLowerCase();
    return terms.every(t => hay.includes(t));
  }), [rows, emailOf, emailFilter, terms.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const m = new Map<string, EInvoiceRow[]>();
    shown.forEach(e => {
      const z = ZONE_MAP[zoneOf(e.MKHang)] || zoneOf(e.MKHang) || 'Khác';
      if (!m.has(z)) m.set(z, []);
      m.get(z)!.push(e);
    });
    return [...m.entries()];
  }, [shown]);

  const noEmail = useMemo(() => rows.filter(e => !emailOf.get(e.MKHang)).length, [rows, emailOf]);

  const openPdf = async (e: EInvoiceRow, type: EinvoicePdfType) => {
    setBusy(`${e.id}|${type}`);
    try { await openEinvoicePdf(e.id, type); }
    catch (err: any) { toast('error', 'Không mở được PDF', err?.message || ''); }
    finally { setBusy(''); }
  };
  const getBillval = async (e: EInvoiceRow) => {
    setBusy(`${e.id}|BILLVAL`);
    try {
      await requestBillval(e.id);
      setRows(prev => prev.map(r => (r.id === e.id ? { ...r, billval: 'ok' } : r))); // chỉ cần biết đã có
      toast('success', 'Đã lấy BILLVAL', `Hóa đơn ${e.KHHDon}/${Number(e.SHDon)}`);
    } catch (err: any) { toast('error', 'Không lấy được BILLVAL', err?.message || ''); }
    finally { setBusy(''); }
  };

  const btnSm = 'vl-btn vl-btn-sm flex items-center gap-1 !px-2 !py-1 text-[11px]';

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      <div className="vl-card p-6 md:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-accent-soft rounded-2xl text-accent"><FileText className="w-6 h-6" /></div>
            <h1 className="text-2xl font-black text-ink tracking-tight uppercase">Hóa đơn điện tử</h1>
          </div>
          <p className="text-sm text-soft max-w-2xl">
            Mỗi dòng là một hóa đơn đã nạp ở "Nạp dữ liệu". Xem hóa đơn và giấy báo tiền điện (PDF từ CCIS).
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <MonthPicker value={ym} onChange={setYm} className="w-full sm:w-[190px]" />
          <div className="relative">
            <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Mã KH, tên, số HĐ…"
              className="pl-10 pr-4 py-2 border border-[var(--border)] bg-surface rounded text-dim text-sm focus:outline-none focus:ring-1 focus:ring-accent w-full sm:w-[220px]" />
          </div>
          <Select value={emailFilter} onChange={setEmailFilter} options={EMAIL_OPTS} icon={Mail} className="sm:w-[200px]" />
          <button onClick={() => void load()} disabled={loading} className="vl-btn vl-btn-secondary flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Nạp lại
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatTile label="Hóa đơn trong tháng" value={rows.length} icon={FileText} loading={loading} />
        <StatTile label="Khách chưa có email" value={noEmail} icon={MailQuestion} tone="warn" loading={loading}
          sub={noEmail ? 'Khai ở Hồ sơ kinh doanh → Khách hàng' : undefined} />
      </div>

      {loading ? (
        <div className="vl-card py-16 text-center text-faint text-sm">Đang tải…</div>
      ) : shown.length === 0 ? (
        <div className="vl-card">
          <EmptyState icon={FileText} title={rows.length ? 'Không có hóa đơn nào khớp bộ lọc' : 'Tháng này chưa nạp hóa đơn nào'}
            hint={rows.length ? undefined : 'Nạp XML hóa đơn ở màn "Nạp dữ liệu".'} />
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([zone, list]) => (
            <ZoneSection key={zone} area={zone} count={list.length} countLabel="hóa đơn">
              <div className="vl-card overflow-x-auto p-0">
                <table className="vl-table w-full min-w-[900px] text-left text-sm">
                  <thead>
                    <tr className="text-[11px] font-bold text-faint uppercase tracking-wider border-b border-[var(--border)]">
                      <th className="py-3 px-3">Số HĐ</th>
                      <th className="py-3 px-3">Khách hàng</th>
                      <th className="py-3 px-3">Kỳ</th>
                      <th className="py-3 px-3 text-right">Tổng tiền</th>
                      <th className="py-3 px-3">Email nhận</th>
                      <th className="py-3 px-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {list.map(e => {
                      const email = emailOf.get(e.MKHang) || '';
                      return (
                        <tr key={e.id} className="hover:bg-subtle/60">
                          <td className="py-3 px-3">
                            <div className="font-mono font-bold text-dim">{e.KHHDon}/{Number(e.SHDon) || e.SHDon}</div>
                            {e.LoaiHD === 'VC' && <span className="vl-badge-info rounded px-1.5 py-0.5 text-[10px] font-bold">Phản kháng</span>}
                          </td>
                          <td className="py-3 px-3 max-w-[280px]">
                            <div className="font-mono text-xs font-bold text-accent">{e.MKHang}</div>
                            <div className="truncate text-xs text-soft" title={e.NMua}>{e.NMua}</div>
                          </td>
                          <td className="py-3 px-3 text-xs text-soft">Kỳ {e.Term || 1} · {pad2(e.Month)}/{e.Year}</td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-ink">{money(e.TgTTTBSo)}</td>
                          <td className="py-3 px-3 max-w-[240px] text-xs">
                            {email
                              ? <span className="block truncate text-soft" title={email}>{email}</span>
                              : <span className="italic text-warn">chưa có email</span>}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {e.billval ? (<>
                                <button onClick={() => void openPdf(e, 'BILLPDF')} disabled={!!busy} title="Xem hóa đơn (PDF)"
                                  className={`${btnSm} vl-btn-outline-primary`}>
                                  {busy === `${e.id}|BILLPDF` ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Receipt className="h-3 w-3" />} Hóa đơn
                                </button>
                                <button onClick={() => void openPdf(e, 'NOTI')} disabled={!!busy} title="Xem giấy báo tiền điện (PDF)"
                                  className={`${btnSm} vl-btn-outline-primary`}>
                                  {busy === `${e.id}|NOTI` ? <RefreshCw className="h-3 w-3 animate-spin" /> : <BellRing className="h-3 w-3" />} Giấy báo
                                </button>
                              </>) : (
                                <button onClick={() => void getBillval(e)} disabled={!!busy} title="Tra CCIS để mở được PDF"
                                  className={`${btnSm} vl-btn-warning`}>
                                  {busy === `${e.id}|BILLVAL` ? <RefreshCw className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />} Lấy BILLVAL
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ZoneSection>
          ))}
        </div>
      )}
    </div>
  );
}
