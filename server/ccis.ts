/**
 * Gọi CCIS (muabandien) từ SERVER: tra đơn vị + sổ của một hóa đơn, dựng BILLVAL,
 * tải PDF giấy báo / hóa đơn. Plan: plans/2026-10-01-ccis-billval-pdf.md.
 *
 * Biến môi trường:
 *   CCIS_BILLVAL_KEY  (bắt buộc) khóa mã hóa BILLVAL — xem `billval.ts`.
 *   CCIS_HOST         máy để KẾT NỐI. Mặc định 1.55.17.129 (01/10/2026 tên miền đang bảo trì).
 *   CCIS_SNI          tên miền để KIỂM CHỨNG CHỈ + header Host. Mặc định muabandien.gelex-electric.com.
 * Kết nối IP nhưng kiểm chứng chỉ theo tên miền ⇒ KHÔNG phải tắt kiểm tra TLS.
 * Hết bảo trì thì đặt CCIS_HOST = tên miền, không sửa code.
 */
import https from 'node:https';
import { billvalPlain, encryptBillval, type BillvalFields } from './billval';

const HOST = () => process.env.CCIS_HOST || '1.55.17.129';
const SNI = () => process.env.CCIS_SNI || 'muabandien.gelex-electric.com';

export function billvalKey(): string {
  const k = process.env.CCIS_BILLVAL_KEY;
  if (!k) throw new CcisError('Server chưa cấu hình CCIS_BILLVAL_KEY.', 500);
  return k;
}

export class CcisError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

function request(method: 'GET' | 'POST', path: string, body?: string): Promise<{ status: number; type: string; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST(), servername: SNI(), port: 443, method, path,
      headers: {
        Host: SNI(),
        ...(body !== undefined ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
      timeout: 90_000,
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), data: Buffer.concat(chunks),
      }));
    });
    req.on('timeout', () => req.destroy(new Error('CCIS quá thời gian chờ')));
    req.on('error', err => reject(new CcisError(`Không kết nối được CCIS (${HOST()}): ${err.message}`)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Gọi phương thức ASMX dạng form (`/Service_HDDT.asmx/<method>`), trả XML. */
async function asmx(method: string, params: Record<string, string | number>): Promise<string> {
  const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const r = await request('POST', `/Service_HDDT.asmx/${method}`, body);
  if (r.status !== 200) throw new CcisError(`CCIS ${method} trả HTTP ${r.status}`);
  return r.data.toString('utf8');
}

/** Giá trị tag đầu tiên (XML phẳng của ASMX). */
const tag = (xml: string, name: string) =>
  (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1]?.trim() ?? '';

interface BillInfo {
  departmentId: number; month: number; year: number; term: number; billType: string; customerCode: string;
}

async function getBillInfo(billId: string): Promise<BillInfo> {
  const xml = await asmx('GetBillInfo', { billId });
  const info = {
    departmentId: Number(tag(xml, 'DepartmentId')), month: Number(tag(xml, 'Month')),
    year: Number(tag(xml, 'Year')), term: Number(tag(xml, 'Term')),
    billType: tag(xml, 'BillType'), customerCode: tag(xml, 'CustomerCode'),
  };
  if (tag(xml, 'BillId') !== billId || !info.departmentId || !info.month || !info.year || !info.billType) {
    throw new CcisError(`CCIS không trả đủ thông tin cho BillId ${billId} (GetBillInfo).`);
  }
  return info;
}

async function getFigureBooks(departmentId: number, year: number, month: number) {
  const xml = await asmx('GetFigureBook', { departmentId, Year: year, Month: month });
  const books = new Map<number, string>(); // id → BookCode (danh sách có thể trùng — loại theo id)
  for (const m of xml.matchAll(/<FigureBookId>(\d+)<\/FigureBookId>[\s\S]*?<BookCode>([^<]*)<\/BookCode>/g)) {
    books.set(Number(m[1]), m[2].trim());
  }
  return books;
}

async function billInBook(term: number, month: number, year: number, figureBookId: number, billId: string) {
  const xml = await asmx('GetBill', { term, month, year, figureBookId });
  return xml.includes(`<BillId>${billId}</BillId>`);
}

/** BookCode của các công tơ trong XML hóa đơn (`TTin` BookCode của từng dòng chỉ số). */
export function bookCodesOfXml(xml: string): string[] {
  const out = new Set<string>();
  for (const m of xml.matchAll(/<TTruong>BookCode<\/TTruong>\s*<KDLieu>[^<]*<\/KDLieu>\s*<DLieu>([^<]+)<\/DLieu>/g)) {
    out.add(m[1].trim());
  }
  return [...out];
}

export interface ResolvedBillval { fields: BillvalFields; billval: string }

/**
 * Dựng BILLVAL cho một hóa đơn: GetBillInfo → sổ khớp BookCode của XML → GetBill xác nhận
 * hóa đơn nằm trong sổ đó. Không khớp BookCode thì thử lần lượt mọi sổ của đơn vị trong kỳ.
 * Không đoán: không xác nhận được sổ thì báo lỗi, KHÔNG mặc định sổ nào.
 */
export async function resolveBillval(billId: string, xml: string): Promise<ResolvedBillval> {
  const key = billvalKey();
  const info = await getBillInfo(billId);
  const books = await getFigureBooks(info.departmentId, info.year, info.month);
  if (!books.size) throw new CcisError(`CCIS không có sổ nào cho đơn vị ${info.departmentId}, ${info.month}/${info.year}.`);
  const wanted = new Set(bookCodesOfXml(xml));
  const ordered = [...books].sort(([, a], [, b]) => Number(wanted.has(b)) - Number(wanted.has(a)));
  // Kỳ của sổ: thử kỳ của hóa đơn trước, rồi 1..3 (GetBillInfo đôi khi trả Term=0).
  const terms = [...new Set([info.term, 1, 2, 3].filter(t => t > 0))];
  for (const [figureBookId] of ordered) {
    for (const term of terms) {
      if (await billInBook(term, info.month, info.year, figureBookId, billId)) {
        const fields: BillvalFields = {
          departmentId: info.departmentId, month: info.month, year: info.year, billType: info.billType,
          status: 0, billId, figureBookId, customerCode: info.customerCode,
        };
        return { fields, billval: encryptBillval(billvalPlain(fields), key) };
      }
    }
  }
  throw new CcisError(`Không tìm thấy sổ chứa BillId ${billId} (đơn vị ${info.departmentId}, ${info.month}/${info.year}).`);
}

export type PdfViewType = 'NOTI' | 'BILLPDF';

/** Tải PDF giấy báo (NOTI) hoặc hóa đơn (BILLPDF). Không phải PDF ⇒ lỗi (thường là trang lỗi/đăng nhập). */
export async function fetchCcisPdf(billval: string, viewType: PdfViewType): Promise<Buffer> {
  const r = await request('GET',
    `/ReportViewer/BillViewer.aspx?viewType=${viewType}&BILLVAL=${encodeURIComponent(billval)}`);
  if (r.status !== 200 || r.data.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new CcisError(`CCIS không trả PDF ${viewType} (HTTP ${r.status}, ${r.type || 'không rõ kiểu'}).`);
  }
  return r.data;
}
