/**
 * API hóa đơn điện tử (`einvoice`) phía server — plans/2026-10-01-ccis-billval-pdf.md.
 *
 *   POST /api/einvoice/:id/billval        tra CCIS, dựng BILLVAL, lưu vào einvoice; xong thì (nếu có
 *                                         FLOW_DONGBO_URL) đẩy nền hóa đơn + 3 file sang flow SharePoint
 *   GET  /api/einvoice/:id/pdf/:type      PDF giấy báo (NOTI) / hóa đơn (BILLPDF), không lưu
 *
 * Xác thực: header `Authorization` = token PocketBase của người dùng (pb.authStore.token).
 * Nhóm (cùng luật `src/lib/userGroup.ts`): lấy BILLVAL chỉ khối Kinh doanh; XEM PDF cho Kinh doanh + Vận hành
 * (user chốt 18/11/2026 — tổ vận hành xem giấy báo/hóa đơn ở Công nợ chỉ xem). Đọc/ghi `einvoice` bằng CHÍNH
 * token đó ⇒ rule PocketBase vẫn áp (tài khoản có `area2` chỉ đọc được hóa đơn KCN mình); server không dùng
 * tài khoản quản trị.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { CcisError, fetchCcisPdf, resolveBillval, type PdfViewType } from './ccis';
import { SHAREPOINT_FIELDS, queueSharepointPush } from './sharepointPush';

/*
  PocketBase để kiểm token và đọc/ghi einvoice phải là PB MÀ GIAO DIỆN ĐANG ĐĂNG NHẬP (`VITE_PB_URL`),
  KHÔNG phải PB trong chính container: staging có PB riêng nhưng giao diện staging trỏ PB production
  (dùng chung dữ liệu) — gọi `localhost:8090` ở staging thì token nào cũng "hết hạn" (sự cố 01/10/2026).
  `PB_INTERNAL_URL` để ghi đè khi cần. Không có biến (localhost không `.env`) ⇒ cùng mặc định với
  `src/lib/pocketbase.ts` (PB production) — trước 18/11/2026 rơi về `localhost:8090` nên localhost lỗi 502.
*/
const PB = () =>
  (process.env.PB_INTERNAL_URL || process.env.VITE_PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const ID_RE = /^[a-z0-9]{15}$/; // id bản ghi PocketBase

type Group = 'van_hanh' | 'kinh_doanh' | 'vat_tu';
interface Authed extends Request { pbToken?: string; group?: Group }

async function pb(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${PB()}${path}`, {
    ...init,
    headers: { Authorization: token, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: body as any };
}

/** Token hợp lệ ⇒ gắn `pbToken` + `group`. */
async function requireAuth(req: Authed, res: Response, next: NextFunction) {
  const token = req.get('authorization') || '';
  if (!token) { res.status(401).json({ message: 'Chưa đăng nhập.' }); return; }
  try {
    const r = await pb('/api/collections/users/auth-refresh', token, { method: 'POST' });
    if (!r.ok) { res.status(401).json({ message: 'Phiên đăng nhập hết hạn — đăng nhập lại.' }); return; }
    // Cùng luật `src/lib/userGroup.ts`: `nhom` có giá trị thì theo nó, trống thì theo `area`.
    const nhom = String(r.body?.record?.nhom ?? '').trim();
    const area = String(r.body?.record?.area ?? '').trim();
    const known: Group[] = ['van_hanh', 'kinh_doanh', 'vat_tu'];
    req.group = (known as string[]).includes(nhom) ? nhom as Group : (area ? 'van_hanh' : 'kinh_doanh');
    req.pbToken = token;
    next();
  } catch (err: any) {
    res.status(502).json({ message: `Không kết nối được PocketBase: ${err?.message || err}` });
  }
}

/** Chỉ cho các nhóm trong danh sách. */
const allow = (groups: Group[], message: string) => (req: Authed, res: Response, next: NextFunction) => {
  if (!req.group || !groups.includes(req.group)) { res.status(403).json({ message }); return; }
  next();
};

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
  r.use(requireAuth);

  r.post('/:id/billval', allow(['kinh_doanh'], 'Chỉ khối Kinh doanh lấy được BILLVAL.'), async (req: Authed, res) => {
    try {
      const rec = await readEinvoice(req.params.id, req.pbToken!, SHAREPOINT_FIELDS);
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
      // Đồng bộ SharePoint (flow "Dong bo HoaDon"): chạy nền sau khi đã trả lời — server/sharepointPush.ts.
      queueSharepointPush(rec, billval);
    } catch (err) { fail(res, err); }
  });

  r.get('/:id/pdf/:type', allow(['kinh_doanh', 'van_hanh'], 'Tài khoản này không xem được giấy báo / hóa đơn.'), async (req: Authed, res) => {
    try {
      const type = req.params.type as PdfViewType;
      if (type !== 'NOTI' && type !== 'BILLPDF') throw new CcisError('Loại PDF phải là NOTI hoặc BILLPDF.', 400);
      const rec = await readEinvoice(req.params.id, req.pbToken!, 'id,billval,KHHDon,SHDon,MKHang');
      if (!rec.billval) throw new CcisError(req.group === 'kinh_doanh'
        ? 'Hóa đơn chưa có BILLVAL — bấm "Lấy BILLVAL" trước.'
        : 'Hóa đơn chưa có PDF — chờ khối Kinh doanh lấy BILLVAL.', 409);
      const pdf = await fetchCcisPdf(String(rec.billval), type);
      const name = `${type === 'NOTI' ? 'GiayBao' : 'HoaDon'}_${rec.MKHang || ''}_${rec.KHHDon || ''}-${rec.SHDon || ''}.pdf`
        .replace(/[^\w.-]/g, '_');
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'no-store' });
      res.send(pdf);
    } catch (err) { fail(res, err); }
  });

  return r;
}
