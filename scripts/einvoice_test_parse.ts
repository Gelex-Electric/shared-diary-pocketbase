/**
 * Kiểm `parseInvoiceXml` (phần đầu mục cho `einvoice`) với một thư mục XML thật.
 * Chạy:  npx tsx scripts/einvoice_test_parse.ts "<thư mục chứa .xml>"
 * CHỈ ĐỌC file local, không gọi mạng. Thoát mã 1 nếu có ca đỏ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { parseInvoiceXml } from '../src/lib/parseInvoiceXml';

(globalThis as any).DOMParser = DOMParser;

const dir = process.argv[2];
if (!dir) { console.error('Cần đường dẫn thư mục XML.'); process.exit(1); }
const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.xml'));
const fail: string[] = [];
const seen = { bill: new Map<string, string>(), key: new Map<string, string>() };
for (const f of files) {
  const xml = fs.readFileSync(path.join(dir, f), 'utf8');
  const inv = parseInvoiceXml(xml);
  // Loại HĐ suy từ tên hóa đơn (CSPK) phải khớp BillType của CCIS (VC = phản kháng).
  const billType = (xml.match(/BillType<\/TTruong><KDLieu>[^<]*<\/KDLieu><DLieu>([^<]*)</) || [])[1];
  if ((billType === 'VC') !== (inv.loaiHD === 'VC')) fail.push(`${f}: BillType ${billType} nhưng loaiHD ${inv.loaiHD}`);
  const h = inv.header;
  const miss = (['khhdon', 'shdon', 'nlap', 'mccqt', 'maTraCuu', 'mstNBan', 'startDate', 'endDate'] as const)
    .filter(k => !h[k]);
  if (!h.year || !h.month) miss.push('year/month' as never);
  if (miss.length) fail.push(`${f}: thiếu ${miss.join(', ')}`);
  if (!h.maTraCuu.startsWith(inv.billId)) fail.push(`${f}: Fkey ${h.maTraCuu} không bắt đầu bằng BillId ${inv.billId}`);
  // Kỳ hóa đơn phải bao trọn kỳ của từng công tơ.
  for (const r of inv.rows) {
    if (r.StartDate < h.startDate || r.EndDate > h.endDate) fail.push(`${f}: công tơ ${r.SCT} ${r.StartDate}..${r.EndDate} ngoài kỳ ${h.startDate}..${h.endDate}`);
  }
  for (const [k, v] of [['bill', inv.billId], ['key', h.maTraCuu]] as const) {
    const prev = seen[k].get(v);
    if (prev) fail.push(`${f}: trùng ${k} ${v} với ${prev}`);
    seen[k].set(v, f);
  }
}
const sample = parseInvoiceXml(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
console.log(`${files.length} file · mẫu ${files[0]}:`, JSON.stringify({ billId: sample.billId, loaiHD: sample.loaiHD, ...sample.header }));
if (fail.length) { console.error(`ĐỎ ${fail.length}:\n` + fail.slice(0, 20).join('\n')); process.exit(1); }
console.log('XANH — đủ trường đầu mục, BillId và mã tra cứu không trùng, kỳ bao trọn các công tơ.');
