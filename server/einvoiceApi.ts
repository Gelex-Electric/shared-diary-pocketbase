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

const PB = () => (process.env.PB_INTERNAL_URL || 'http://localhost:8090').replace(/\/$/, '');
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

  return r;
}
