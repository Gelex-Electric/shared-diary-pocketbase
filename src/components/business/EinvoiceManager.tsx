/* ================================================================
   "Hóa đơn điện tử" — mục con Hồ sơ kinh doanh (plans/2026-10-01-trang-hoa-don-dien-tu.md).

   Mỗi dòng = một bản ghi `einvoice` (một hóa đơn = một XML đã nạp). Ba chức năng:
   - Xem hóa đơn (BILLPDF) / Xem giấy báo (NOTI): PDF tải từ CCIS qua server, KHÔNG lưu.
   - Gửi email: server lấy người nhận từ danh mục khách hàng (`dm_customer.email`), BCC email
     trực vận hành + công ty mẹ của KCN, đính kèm 2 PDF + XML; ghi kết quả vào `einvoice.mail_*`.
   Gửi hàng loạt = tick nhiều dòng, gửi LẦN LƯỢT (giới hạn Office 365 ~30 thư/phút).
   Đã gửi rồi vẫn gửi lại được, có hộp xác nhận nhắc lần gửi trước (user chốt 01/10/2026).
================================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing, Receipt, Send, KeyRound, RefreshCw, Search, FileText, MailCheck, MailX, MailQuestion, Mail,
} from 'lucide-react';
import { pb } from '../../lib/pocketbase';
import { MonthPicker } from '../ui/DateTimePickers';
import { Select } from '../ui/Select';
import { useConfirm } from '../ui/ConfirmDialog';
import { StatTile, EmptyState } from '../ui/dashboard';
import { ZoneSection } from './ZoneSection';
import { ZONE_MAP, zoneOf } from '../../lib/invoices';
import { openEinvoicePdf, requestBillval, sendEinvoiceMail, type EinvoicePdfType } from '../../lib/einvoiceApi';
import { toast as notify } from '../../lib/toast';

interface EInvoiceRow {
  id: string;
  BillId: string;
  LoaiHD: string;
  Year: number; Month: number; Term: number;
  KHMSHDon: string; KHHDon: string; SHDon: string; NLap?: string;
  MKHang: string; NMua: string; TgTTTBSo: number;
  billval?: string;
  mail_status?: '' | 'chua_gui' | 'da_gui' | 'loi';
  mail_sent_at?: string; mail_to?: string; mail_error?: string;
}

/** Không tải `xml` (toàn văn ~24 KB/hóa đơn) — chỉ server cần khi gửi. */
const FIELDS = 'id,BillId,LoaiHD,Year,Month,Term,KHMSHDon,KHHDon,SHDon,NLap,MKHang,NMua,TgTTTBSo,billval,mail_status,mail_sent_at,mail_to,mail_error';

const STATUS_OPTS = [
  { value: '', label: 'Mọi trạng thái' },
  { value: 'chua_gui', label: 'Chưa gửi' },
  { value: 'da_gui', label: 'Đã gửi' },
  { value: 'loi', label: 'Gửi lỗi' },
  { value: 'no_email', label: 'Khách chưa có email' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const money = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));
const dmyHm = (s?: string) => {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? s
    : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const statusOf = (e: EInvoiceRow) => (e.mail_status || 'chua_gui') as 'chua_gui' | 'da_gui' | 'loi';

export default function EinvoiceManager() {
  const { confirm, dialog } = useConfirm();
  const [ym, setYm] = useState('');
  const [rows, setRows] = useState<EInvoiceRow[]>([]);
  /** mkh → email trong danh mục (đã chuẩn hoá `a; b`). */
  const [emailOf, setEmailOf] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** `<id>|<NOTI|BILLPDF|BILLVAL|SEND>` đang chạy. */
  const [busy, setBusy] = useState('');
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  const toast = useCallback((t: 'success' | 'error' | 'warning' | 'info', title: string, msg: string) =>
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
      setSelected(new Set());
    } catch (err: any) {
      toast('error', 'Lỗi', `Không tải được hóa đơn: ${err?.message || ''}`);
    } finally {
      setLoading(false);
    }
  }, [ym, toast]);
  useEffect(() => { void load(); }, [load]);

  const patchRow = (id: string, p: Partial<EInvoiceRow>) =>
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...p } : r)));

  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => rows.filter(e => {
    const hasEmail = !!emailOf.get(e.MKHang);
    if (status === 'no_email' ? hasEmail : status && statusOf(e) !== status) return false;
    const hay = `${e.MKHang} ${e.NMua} ${e.KHHDon}/${e.SHDon} ${Number(e.SHDon)}`.toLowerCase();
    return terms.every(t => hay.includes(t));
  }), [rows, emailOf, status, terms.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const m = new Map<string, EInvoiceRow[]>();
    shown.forEach(e => {
      const z = ZONE_MAP[zoneOf(e.MKHang)] || zoneOf(e.MKHang) || 'Khác';
      if (!m.has(z)) m.set(z, []);
      m.get(z)!.push(e);
    });
    return [...m.entries()];
  }, [shown]);

  const stats = useMemo(() => ({
    total: rows.length,
    sent: rows.filter(e => statusOf(e) === 'da_gui').length,
    failed: rows.filter(e => statusOf(e) === 'loi').length,
    noEmail: rows.filter(e => !emailOf.get(e.MKHang)).length,
  }), [rows, emailOf]);

  /* ── PDF / BILLVAL ── */
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
      patchRow(e.id, { billval: 'ok' }); // chỉ cần biết đã có; giá trị thật nằm ở server
      toast('success', 'Đã lấy BILLVAL', `Hóa đơn ${e.KHHDon}/${Number(e.SHDon)}`);
    } catch (err: any) { toast('error', 'Không lấy được BILLVAL', err?.message || ''); }
    finally { setBusy(''); }
  };

  /* ── Gửi email ── */
  const sendOne = async (e: EInvoiceRow): Promise<boolean> => {
    try {
      const r = await sendEinvoiceMail(e.id);
      patchRow(e.id, { mail_status: 'da_gui', mail_sent_at: r.sentAt, mail_to: r.to.join('; '), mail_error: '', billval: e.billval || 'ok' });
      return true;
    } catch (err: any) {
      patchRow(e.id, { mail_status: 'loi', mail_error: err?.message || 'lỗi' });
      return false;
    }
  };

  const confirmSend = async (e: EInvoiceRow) => {
    const to = emailOf.get(e.MKHang) || '';
    const again = statusOf(e) === 'da_gui';
    const ok = await confirm({
      title: again ? 'Gửi lại hóa đơn?' : 'Gửi hóa đơn cho khách?',
      message: `Hóa đơn ${e.KHHDon}/${Number(e.SHDon)} — ${e.MKHang} ${e.NMua}\n`
        + `Gửi tới: ${to}\nĐính kèm: giấy báo (PDF), hóa đơn (PDF), XML. BCC: email trực vận hành + công ty mẹ của KCN.`
        + (again ? `\n\nĐÃ GỬI lúc ${dmyHm(e.mail_sent_at)} tới ${e.mail_to}.` : ''),
      confirmLabel: again ? 'Gửi lại' : 'Gửi',
      variant: again ? 'warning' : 'info',
    });
    if (!ok) return;
    setBusy(`${e.id}|SEND`);
    const sent = await sendOne(e);
    setBusy('');
    if (sent) toast('success', 'Đã gửi', `Hóa đơn ${e.KHHDon}/${Number(e.SHDon)} tới ${to}`);
    else toast('error', 'Gửi lỗi', `Hóa đơn ${e.KHHDon}/${Number(e.SHDon)} — xem lý do ở cột Trạng thái`);
  };

  const sendSelected = async () => {
    const list = rows.filter(e => selected.has(e.id));
    const sendable = list.filter(e => emailOf.get(e.MKHang));
    if (!sendable.length) { toast('warning', 'Chưa gửi được', 'Các hóa đơn đã chọn đều thuộc khách chưa có email.'); return; }
    const again = sendable.filter(e => statusOf(e) === 'da_gui').length;
    const skip = list.length - sendable.length;
    const ok = await confirm({
      title: `Gửi ${sendable.length} hóa đơn?`,
      message: `Mỗi khách nhận giấy báo + hóa đơn (PDF) + XML tới email trong danh mục, BCC email của KCN.`
        + (skip ? `\nBỏ qua ${skip} hóa đơn của khách chưa có email.` : '')
        + (again ? `\n\n${again} hóa đơn ĐÃ GỬI trước đó sẽ được gửi lại.` : ''),
      confirmLabel: 'Gửi',
      variant: again ? 'warning' : 'info',
    });
    if (!ok) return;
    setBulk({ done: 0, total: sendable.length });
    let okCount = 0;
    for (let i = 0; i < sendable.length; i++) {
      if (await sendOne(sendable[i])) okCount++;
      setBulk({ done: i + 1, total: sendable.length });
    }
    setBulk(null);
    setSelected(new Set());
    const bad = sendable.length - okCount;
    toast(bad ? 'warning' : 'success', 'Gửi xong', `Đã gửi ${okCount}/${sendable.length}` + (bad ? `, lỗi ${bad} — xem cột Trạng thái` : ''));
  };

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const allShownSelected = shown.length > 0 && shown.every(e => selected.has(e.id));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(shown.map(e => e.id)));
  const working = !!busy || !!bulk;

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
            Mỗi dòng là một hóa đơn đã nạp ở "Nạp dữ liệu". Xem hóa đơn, giấy báo tiền điện và gửi email cho khách
            (email lấy từ danh mục khách hàng; BCC email trực vận hành và công ty mẹ của KCN).
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <MonthPicker value={ym} onChange={setYm} className="w-full sm:w-[190px]" />
          <div className="relative">
            <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Mã KH, tên, số HĐ…"
              className="pl-10 pr-4 py-2 border border-[var(--border)] bg-surface rounded text-dim text-sm focus:outline-none focus:ring-1 focus:ring-accent w-full sm:w-[220px]" />
          </div>
          <Select value={status} onChange={setStatus} options={STATUS_OPTS} icon={Mail} className="sm:w-[200px]" />
          <button onClick={() => void load()} disabled={loading} className="vl-btn vl-btn-secondary flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Nạp lại
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Hóa đơn trong tháng" value={stats.total} icon={FileText} loading={loading} />
        <StatTile label="Đã gửi" value={stats.sent} icon={MailCheck} tone="ok" loading={loading} />
        <StatTile label="Gửi lỗi" value={stats.failed} icon={MailX} tone="bad" loading={loading} />
        <StatTile label="Khách chưa có email" value={stats.noEmail} icon={MailQuestion} tone="warn" loading={loading}
          sub={stats.noEmail ? 'Khai ở Hồ sơ kinh doanh → Khách hàng' : undefined} />
      </div>

      <div className="vl-card p-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs font-bold text-soft">
          <input type="checkbox" checked={allShownSelected} onChange={toggleAll} className="w-4 h-4 accent-[var(--accent)]" />
          Chọn tất cả đang hiện ({shown.length})
        </label>
        <button onClick={() => void sendSelected()} disabled={working || selected.size === 0}
          className="vl-btn vl-btn-primary flex items-center gap-2">
          {bulk ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {bulk ? `Đang gửi ${bulk.done}/${bulk.total}…` : `Gửi các hóa đơn đã chọn (${selected.size})`}
        </button>
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
                <table className="vl-table w-full min-w-[1080px] text-left text-sm">
                  <thead>
                    <tr className="text-[11px] font-bold text-faint uppercase tracking-wider border-b border-[var(--border)]">
                      <th className="py-3 px-3 w-10"></th>
                      <th className="py-3 px-3">Số HĐ</th>
                      <th className="py-3 px-3">Khách hàng</th>
                      <th className="py-3 px-3">Kỳ</th>
                      <th className="py-3 px-3 text-right">Tổng tiền</th>
                      <th className="py-3 px-3">Email nhận</th>
                      <th className="py-3 px-3">Trạng thái</th>
                      <th className="py-3 px-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {list.map(e => {
                      const email = emailOf.get(e.MKHang) || '';
                      const st = statusOf(e);
                      return (
                        <tr key={e.id} className={`hover:bg-subtle/60 ${selected.has(e.id) ? 'bg-accent-soft' : ''}`}>
                          <td className="py-3 px-3">
                            <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} className="w-4 h-4 accent-[var(--accent)]" />
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-mono font-bold text-dim">{e.KHHDon}/{Number(e.SHDon) || e.SHDon}</div>
                            {e.LoaiHD === 'VC' && <span className="vl-badge-info rounded px-1.5 py-0.5 text-[10px] font-bold">Phản kháng</span>}
                          </td>
                          <td className="py-3 px-3 max-w-[260px]">
                            <div className="font-mono text-xs font-bold text-accent">{e.MKHang}</div>
                            <div className="truncate text-xs text-soft" title={e.NMua}>{e.NMua}</div>
                          </td>
                          <td className="py-3 px-3 text-xs text-soft">Kỳ {e.Term || 1} · {pad2(e.Month)}/{e.Year}</td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-ink">{money(e.TgTTTBSo)}</td>
                          <td className="py-3 px-3 max-w-[220px] text-xs">
                            {email
                              ? <span className="block truncate text-soft" title={email}>{email}</span>
                              : <span className="italic text-warn">chưa có email</span>}
                          </td>
                          <td className="py-3 px-3 text-xs">
                            {st === 'da_gui' && (
                              <span className="vl-badge-success rounded px-1.5 py-0.5 text-[10px] font-bold" title={`Tới ${e.mail_to || ''}`}>
                                Đã gửi {dmyHm(e.mail_sent_at)}
                              </span>
                            )}
                            {st === 'loi' && (
                              <span className="vl-badge-danger rounded px-1.5 py-0.5 text-[10px] font-bold" title={e.mail_error || ''}>
                                Gửi lỗi
                              </span>
                            )}
                            {st === 'chua_gui' && <span className="text-faint">Chưa gửi</span>}
                            {st === 'loi' && e.mail_error && (
                              <div className="mt-1 max-w-[220px] truncate text-[11px] text-bad" title={e.mail_error}>{e.mail_error}</div>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {e.billval ? (<>
                                <button onClick={() => void openPdf(e, 'BILLPDF')} disabled={working} title="Xem hóa đơn (PDF)"
                                  className={`${btnSm} vl-btn-outline-primary`}>
                                  {busy === `${e.id}|BILLPDF` ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Receipt className="h-3 w-3" />} Hóa đơn
                                </button>
                                <button onClick={() => void openPdf(e, 'NOTI')} disabled={working} title="Xem giấy báo tiền điện (PDF)"
                                  className={`${btnSm} vl-btn-outline-primary`}>
                                  {busy === `${e.id}|NOTI` ? <RefreshCw className="h-3 w-3 animate-spin" /> : <BellRing className="h-3 w-3" />} Giấy báo
                                </button>
                              </>) : (
                                <button onClick={() => void getBillval(e)} disabled={working} title="Tra CCIS để mở được PDF"
                                  className={`${btnSm} vl-btn-warning`}>
                                  {busy === `${e.id}|BILLVAL` ? <RefreshCw className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />} Lấy BILLVAL
                                </button>
                              )}
                              <button onClick={() => void confirmSend(e)} disabled={working || !email}
                                title={email ? (st === 'da_gui' ? 'Gửi lại email' : 'Gửi email') : 'Khách chưa có email trong danh mục'}
                                className={`${btnSm} ${st === 'da_gui' ? 'vl-btn-secondary' : 'vl-btn-primary'}`}>
                                {busy === `${e.id}|SEND` ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                {st === 'da_gui' ? 'Gửi lại' : 'Gửi'}
                              </button>
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
      {dialog}
    </div>
  );
}
