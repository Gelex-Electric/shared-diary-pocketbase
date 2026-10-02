/**
 * Kiểm `server/billval.ts` + `bookCodesOfXml` — KHÔNG gọi mạng.
 *   1. Giải BILLVAL mẫu (lấy từ CCIS thật, hướng dẫn 01/10/2026) phải ra đúng chuỗi gốc.
 *   2. Mã hóa → giải ngược khớp; hai lần mã hóa cho chuỗi khác nhau (salt/IV ngẫu nhiên).
 *   3. BookCode đọc từ XML hóa đơn (nếu truyền thư mục XML).
 * Chạy (khóa lấy từ Railway, không ghi ra đâu):
 *   railway.exe run --service shared-diary-pocketbase --environment staging -- npx tsx scripts/billval_test.ts [thư mục XML]
 */
import fs from 'node:fs';
import path from 'node:path';
import { billvalPlain, decryptBillval, encryptBillval } from '../server/billval';
import { bookCodesOfXml } from '../server/ccis';

const key = process.env.CCIS_BILLVAL_KEY;
if (!key) { console.error('Thiếu CCIS_BILLVAL_KEY (chạy qua railway run).'); process.exit(1); }
const fail: string[] = [];

const SAMPLE = decodeURIComponent('bWBtE30WiLV0EVVTOSKIhrhDrlvoQ1Z20kNgU2y1rbB6cKFtIk1Sy6rA20frHGWmz%2FEgFzhmDZcSxvRjU8PUHLGKo09ySSBOUwzhfwU5LKc0dxXK6%2F5DWpKDZxxVUk7R');
const got = decryptBillval(SAMPLE, key);
if (got !== '2|5|2026|TD|0|32183|1|KCNTH-001') fail.push(`giải mẫu ra "${got}"`);

const plain = billvalPlain({
  departmentId: 12, month: 7, year: 2026, billType: 'TD', status: 0, billId: '32529', figureBookId: 23, customerCode: 'KCNYM-004',
});
if (plain !== '12|7|2026|TD|0|32529|23|KCNYM-004') fail.push(`billvalPlain ra "${plain}"`);
const a = encryptBillval(plain, key), b = encryptBillval(plain, key);
if (decryptBillval(a, key) !== plain) fail.push('mã hóa → giải ngược không khớp');
if (a === b) fail.push('hai lần mã hóa giống nhau (salt/IV không ngẫu nhiên?)');
if (/[+&?\\]/.test(a)) fail.push('BILLVAL còn ký tự đặc biệt chưa thay');
// Dài khác nhau (khác số khối) vẫn phải giải được — mã KH dài, 2 khối.
const long = '12|7|2026|TD|0|32529|23|KCNYM-004-RAT-DAI-DE-SANG-KHOI-THU-HAI';
if (decryptBillval(encryptBillval(long, key), key) !== long) fail.push('chuỗi 2 khối không khớp');

const dir = process.argv[2];
if (dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
  const none = files.filter(f => !bookCodesOfXml(fs.readFileSync(path.join(dir, f), 'utf8')).length);
  if (none.length) fail.push(`${none.length}/${files.length} XML không đọc được BookCode: ${none.slice(0, 3).join(', ')}`);
  const sample = bookCodesOfXml(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  console.log(`BookCode: ${files.length} XML, mẫu ${files[0]} → ${sample.join(', ')}`);
}

if (fail.length) { console.error('ĐỎ:\n' + fail.join('\n')); process.exit(1); }
console.log('XANH — giải BILLVAL mẫu đúng, mã hóa/giải ngược khớp, salt/IV ngẫu nhiên.');
