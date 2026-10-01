/**
 * BILLVAL của CCIS — tham số mã hóa của `ReportViewer/BillViewer.aspx` để tải PDF
 * giấy báo (viewType=NOTI) và hóa đơn (viewType=BILLPDF). Thuật toán bóc từ
 * `EncodeText.Encrypt` trong `ES_CCIS.dll` (user bóc tách 01/10/2026,
 * `document/HUONG_DAN_TAI_HAI_BAN_PDF.md` — file đó nằm NGOÀI repo vì chứa khóa).
 *
 *   plain   = DepartmentId|Month|Year|BillType|Status|BillId|FigureBookId|CustomerCode
 *   salt,IV = 32 byte ngẫu nhiên mỗi lần
 *   key     = PBKDF2-HMAC-SHA1(CCIS_BILLVAL_KEY, salt, 1000 vòng, 32 byte)
 *   cipher  = Rijndael-CBC, KHỐI 256 bit (KHÔNG phải AES — AES chỉ có khối 128), PKCS7
 *   BILLVAL = base64(salt‖IV‖cipher) rồi thay + & ? \ → XYZ1 XYZ2 XYZ3 XYZ4
 *
 * ⚠️ Khóa CHỈ đọc từ biến môi trường `CCIS_BILLVAL_KEY`, chỉ dùng phía server. Ai có
 * khóa là tạo được link tải PDF của MỌI khách hàng — không đưa vào repo (PUBLIC) hay
 * code trình duyệt, không ghi log BILLVAL.
 */
import crypto from 'node:crypto';
import Rijndael from 'rijndael-js';

const BLOCK = 32; // 256 bit
const BACKSLASH = String.fromCharCode(92);
const SWAP: [string, string][] = [['+', 'XYZ1'], ['&', 'XYZ2'], ['?', 'XYZ3'], [BACKSLASH, 'XYZ4']];

const swapOut = (s: string) => SWAP.reduce((acc, [from, to]) => acc.split(from).join(to), s);
const swapIn = (s: string) => SWAP.reduce((acc, [from, to]) => acc.split(to).join(from), s);

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, 1000, 32, 'sha1');
}

export interface BillvalFields {
  departmentId: number;
  month: number;
  year: number;
  /** Loại hóa đơn của CCIS: `TD` (tiền điện) hoặc `VC` (phản kháng). */
  billType: string;
  /** Giá trị trang xem dùng chọn luồng — `0` (theo hướng dẫn); KHÔNG phải trạng thái nghiệp vụ. */
  status: number;
  billId: string;
  figureBookId: number;
  customerCode: string;
}

export const billvalPlain = (f: BillvalFields) =>
  [f.departmentId, f.month, f.year, f.billType, f.status, f.billId, f.figureBookId, f.customerCode].join('|');

/** Mã hóa chuỗi 8 trường thành BILLVAL (chưa URL-encode). */
export function encryptBillval(plain: string, secret: string): string {
  const salt = crypto.randomBytes(BLOCK);
  const iv = crypto.randomBytes(BLOCK);
  const data = Buffer.from(plain, 'utf8');
  const n = BLOCK - (data.length % BLOCK);
  const padded = Buffer.concat([data, Buffer.alloc(n, n)]); // PKCS7 theo khối 32 byte
  const ct = Buffer.from(new Rijndael(deriveKey(secret, salt), 'cbc').encrypt(padded, BLOCK * 8, iv));
  return swapOut(Buffer.concat([salt, iv, ct]).toString('base64'));
}

/** Giải BILLVAL (chưa URL-encode) về chuỗi 8 trường — dùng để kiểm thử và soát lỗi. */
export function decryptBillval(billval: string, secret: string): string {
  const raw = Buffer.from(swapIn(billval), 'base64');
  const salt = raw.subarray(0, BLOCK);
  const iv = raw.subarray(BLOCK, BLOCK * 2);
  const ct = raw.subarray(BLOCK * 2);
  const out = Buffer.from(new Rijndael(deriveKey(secret, salt), 'cbc').decrypt(ct, BLOCK * 8, iv));
  const pad = out[out.length - 1];
  if (!pad || pad > BLOCK) throw new Error('BILLVAL không hợp lệ (đệm sai)');
  return out.subarray(0, out.length - pad).toString('utf8');
}
