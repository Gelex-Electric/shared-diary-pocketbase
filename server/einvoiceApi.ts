/**
 * API hóa đơn điện tử (`einvoice`) phía server — plans/2026-10-01-ccis-billval-pdf.md.
 *
 *   POST /api/einvoice/:id/billval        tra CCIS, dựng BILLVAL, lưu vào einvoice
 *   GET  /api/einvoice/:id/pdf/:type      PDF giấy báo (NOTI) / hóa đơn (BILLPDF), không lưu
 *
 * Xác thực: header `Authorization` = token PocketBase của người dùng (pb.authStore.token).
 * Chỉ khối Kinh doanh (`users.area` trống — cùng luật với App.tsx). Đọc/ghi `einvoice`
 * bằng CHÍNH token đó ⇒ rule của PocketBase vẫn áp; server không dùng tài khoản quản trị.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { CcisError, fetchCcisPdf, resolveBillval, type PdfViewType } from './ccis';
import { sendInvoiceMail, type EinvoiceForMail } from './mail';

/*
  Tách ô email (một hoặc nhiều địa chỉ ngăn bằng ; , xuống dòng) — cùng luật `src/lib/dm/email.ts`.
  Chép lại ở đây vì image Docker chỉ copy `server/`, không có `src/`.
*/
const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]{2,}$/;
const emailsOf = (...cells: unknown[]) => [...new Set(cells
  .flatMap(c => String(c ?? '').split(/[;,\n]/))
  .map(e => e.trim().toLowerCase())
  .filter(e => EMAIL_RE.test(e)))];

/*
  PocketBase để kiểm token và đọc/ghi einvoice phải là PB MÀ GIAO DIỆN ĐANG ĐĂNG NHẬP (`VITE_PB_URL`),
  KHÔNG phải PB trong chính container: staging có PB riêng nhưng giao diện staging trỏ PB production
  (dùng chung dữ liệu) — gọi `localhost:8090` ở staging thì token nào cũng "hết hạn" (sự cố 01/10/2026).
  `PB_INTERNAL_URL` để ghi đè khi cần.
*/
const PB = () =>
  (process.env.PB_INTERNAL_URL || process.env.VITE_PB_URL || 'http://localhost:8090').replace(/\/$/, '');
const ID_RE = /^[a-z0-9]{15}$/; // id bản ghi PocketBase

interface Authed extends Request { pbToken?: string }

async function pb(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${PB()}${path}`, {
    ...init,
    headers: { Authorization: token, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: body as any };
}

/** Token hợp lệ + thuộc khối Kinh doanh. */
async function requireBusiness(req: Authed, res: Response, next: NextFunction) {
  const token = req.get('authorization') || '';
  if (!token) { res.status(401).json({ message: 'Chưa đăng nhập.' }); return; }
  try {
    const r = await pb('/api/collections/users/auth-refresh', token, { method: 'POST' });
    if (!r.ok) { res.status(401).json({ message: 'Phiên đăng nhập hết hạn — đăng nhập lại.' }); return; }
    const area = String(r.body?.record?.area ?? '').trim();
    if (area) { res.status(403).json({ message: 'Chỉ khối Kinh doanh dùng được chức năng này.' }); return; }
    req.pbToken = token;
    next();
  } catch (err: any) {
    res.status(502).json({ message: `Không kết nối được PocketBase: ${err?.message || err}` });
  }
}

/** Đọc einvoice bằng token người dùng — không thấy (sai id hoặc rule chặn) ⇒ 404. */
async function readEinvoice(id: string, token: string, fields: string) {
  if (!ID_RE.test(id)) throw new CcisError('Mã hóa đơn không hợp lệ.', 400);
  const r = await pb(`/api/collections/einvoice/records/${id}?fields=${fields}`, token);
  if (!r.ok) throw new CcisError('Không tìm thấy hóa đơn (hoặc không có quyền xem).', 404);
  return r.body;
}

const fail = (res: Response, err: any) => {
  const status = err instanceof CcisError ? err.status : 500;
  if (status >= 500) console.error('[einvoice]', err?.message || err);
  res.status(status).json({ message: err?.message || 'Lỗi không xác định' });
};

export function einvoiceRouter() {
  const r = express.Router();
  r.use(requireBusiness);

  r.post('/:id/billval', async (req: Authed, res) => {
    try {
      const rec = await readEinvoice(req.params.id, req.pbToken!, 'id,BillId,xml');
      if (!rec.BillId || !rec.xml) throw new CcisError('Hóa đơn thiếu BillId hoặc XML.', 422);
      const { fields, billval } = await resolveBillval(String(rec.BillId), String(rec.xml));
      const up = await pb(`/api/collections/einvoice/records/${rec.id}?fields=id`, req.pbToken!, {
        method: 'PATCH',
        body: JSON.stringify({
          billval, ccis_department: fields.departmentId, ccis_figure_book: fields.figureBookId,
        }),
      });
      if (!up.ok) throw new CcisError(`Không lưu được BILLVAL: ${up.body?.message || up.status}`, up.status);
      res.json({ ok: true, departmentId: fields.departmentId, figureBookId: fields.figureBookId });
    } catch (err) { fail(res, err); }
  });

  r.get('/:id/pdf/:type', async (req: Authed, res) => {
    try {
      const type = req.params.type as PdfViewType;
      if (type !== 'NOTI' && type !== 'BILLPDF') throw new CcisError('Loại PDF phải là NOTI hoặc BILLPDF.', 400);
      const rec = await readEinvoice(req.params.id, req.pbToken!, 'id,billval,KHHDon,SHDon,MKHang');
      if (!rec.billval) throw new CcisError('Hóa đơn chưa có BILLVAL — bấm "Lấy BILLVAL" trước.', 409);
      const pdf = await fetchCcisPdf(String(rec.billval), type);
      const name = `${type === 'NOTI' ? 'GiayBao' : 'HoaDon'}_${rec.MKHang || ''}_${rec.KHHDon || ''}-${rec.SHDon || ''}.pdf`
        .replace(/[^\w.-]/g, '_');
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'no-store' });
      res.send(pdf);
    } catch (err) { fail(res, err); }
  });

  /*
    Gửi thư hóa đơn: To = email khách trong danh mục (SERVER tự đọc — trình duyệt không truyền
    địa chỉ, nên API không thành công cụ gửi thư tùy ý); BCC = email trực vận hành + công ty mẹ
    của KCN. Đính kèm: giấy báo + hóa đơn (tải CCIS lúc gửi, không lưu) + XML đã nạp.
    Thiếu file nào thì KHÔNG gửi. Kết quả ghi vào einvoice.mail_*.
  */
  r.post('/:id/send', async (req: Authed, res) => {
    const token = req.pbToken!;
    let recId = '';
    try {
      const inv = await readEinvoice(req.params.id, token,
        'id,BillId,LoaiHD,Month,Year,Term,StartDate,EndDate,KHMSHDon,KHHDon,SHDon,NLap,MaTraCuu,MSTNBan,NBan,MKHang,NMua,TgTTTBSo,xml,xml_name,billval');
      recId = inv.id;
      if (!inv.xml) throw new CcisError('Hóa đơn chưa có XML.', 422);

      const cus = await pb(`/api/collections/dm_customer/records?perPage=1&filter=${encodeURIComponent(`mkh = "${String(inv.MKHang).replace(/"/g, '')}"`)}&fields=id,email,zone`, token);
      const customer = cus.body?.items?.[0];
      const to = emailsOf(customer?.email);
      if (!to.length) throw new CcisError(`Khách ${inv.MKHang} chưa có email trong danh mục.`, 422);

      let zoneName = '';
      let bcc: string[] = [];
      let contact: string[] = [];
      if (customer?.zone) {
        const z = await pb(`/api/collections/dm_zone/records/${customer.zone}?fields=name,email_ops,email_parent`, token);
        if (z.ok) {
          zoneName = z.body.name || '';
          bcc = emailsOf(z.body.email_ops, z.body.email_parent).filter(e => !to.includes(e));
          contact = emailsOf(z.body.email_parent);
        }
      }

      let billval = String(inv.billval || '');
      if (!billval) {
        const r2 = await resolveBillval(String(inv.BillId), String(inv.xml));
        billval = r2.billval;
        await pb(`/api/collections/einvoice/records/${inv.id}?fields=id`, token, {
          method: 'PATCH',
          body: JSON.stringify({ billval, ccis_department: r2.fields.departmentId, ccis_figure_book: r2.fields.figureBookId }),
        });
      }
      const [noticePdf, invoicePdf] = await Promise.all([fetchCcisPdf(billval, 'NOTI'), fetchCcisPdf(billval, 'BILLPDF')]);

      const sent = await sendInvoiceMail({ inv: inv as EinvoiceForMail, to, bcc, zoneName, contact, noticePdf, invoicePdf });
      const sentAt = new Date().toISOString();
      await pb(`/api/collections/einvoice/records/${inv.id}?fields=id`, token, {
        method: 'PATCH',
        body: JSON.stringify({ mail_status: 'da_gui', mail_sent_at: sentAt, mail_to: to.join('; '), mail_error: '' }),
      });
      res.json({ ok: true, to, bcc: bcc.length, sentAt, accepted: sent.accepted.length });
    } catch (err: any) {
      // Ghi lý do lỗi vào hóa đơn (nếu đã đọc được) để trang hiện "Gửi lỗi" kèm lý do.
      if (recId) {
        await pb(`/api/collections/einvoice/records/${recId}?fields=id`, token, {
          method: 'PATCH',
          body: JSON.stringify({ mail_status: 'loi', mail_error: String(err?.message || err).slice(0, 900) }),
        }).catch(() => {});
      }
      fail(res, err);
    }
  });

  return r;
}
