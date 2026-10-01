/**
 * Dựng thư hóa đơn (KHÔNG gửi — nodemailer streamTransport) từ XML thật, soát tiêu đề / người gửi /
 * đính kèm / nội dung. Không gọi mạng, PDF là bản giả.
 *   npx tsx scripts/einvoice_mail_test.mts "<thư mục XML>" [tệp HTML xuất ra để xem]
 * Thoát mã 1 nếu có ca đỏ.
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { DOMParser } from '@xmldom/xmldom';
import { parseInvoiceXml } from '../src/lib/parseInvoiceXml';
import { buildInvoiceMail } from '../server/mail';

(globalThis as any).DOMParser = DOMParser;
process.env.SMTP_USER = 'hop-thu-smtp@example.com';

const [dir, htmlOut] = process.argv.slice(2);
if (!dir) { console.error('Cần thư mục XML.'); process.exit(1); }
const fakePdf = Buffer.from('%PDF-1.4 test');
const fail: string[] = [];
let sample: ReturnType<typeof buildInvoiceMail> | null = null;

const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.xml'));
console.log(`${files.length} XML trong ${dir}`);
if (!files.length) fail.push('không có file XML nào — test không kiểm được gì');
for (const name of files) {
  const xml = fs.readFileSync(path.join(dir, name), 'utf8');
  const p = parseInvoiceXml(xml); const h = p.header;
  const mail = buildInvoiceMail({
    inv: {
      BillId: p.billId, LoaiHD: p.loaiHD, Month: h.month, Year: h.year, Term: h.term, StartDate: h.startDate, EndDate: h.endDate,
      KHMSHDon: h.khmshdon, KHHDon: h.khhdon, SHDon: h.shdon, NLap: h.nlap, MaTraCuu: h.maTraCuu, MSTNBan: h.mstNBan,
      NBan: p.nban.ten, MKHang: p.nmua.mkhang, NMua: p.nmua.ten, TgTTTBSo: p.tgTTTBSo, xml, xml_name: name,
    },
    to: ['khach@example.com'], bcc: ['trucvh@example.com'], zoneName: 'KCN thử', contact: ['ctyme@example.com'], noticePdf: fakePdf, invoicePdf: fakePdf,
  });
  sample ??= mail;
  const money = new Intl.NumberFormat('vi-VN').format(p.tgTTTBSo);
  if (!mail.subject.includes(p.nmua.mkhang) || !mail.subject.includes(`${h.khhdon}/`)) fail.push(`${name}: tiêu đề thiếu MKH/số HĐ`);
  if (mail.from.name !== p.nban.ten) fail.push(`${name}: tên người gửi ≠ công ty bán`);
  for (const must of [h.maTraCuu, h.mstNBan, money, p.nmua.mkhang, 'mailto:ctyme@example.com']) if (!mail.html.includes(must)) fail.push(`${name}: HTML thiếu "${must}"`);
  const ten = `${p.loaiHD === 'VC' ? 'phản kháng' : 'tiền điện'} kỳ ${h.term || 1} tháng ${String(h.month).padStart(2, '0')} năm ${h.year}`;
  const wantNames = [`Thông báo ${ten}.pdf`, `Hóa đơn ${ten}.pdf`, `Hóa đơn ${ten}.xml`];
  const gotNames = mail.attachments.map(a => a.filename);
  if (gotNames.join('|') !== wantNames.join('|')) fail.push(`${name}: tên đính kèm ${gotNames.join(' | ')}`);
  if (p.loaiHD === 'VC' && !mail.subject.includes('phản kháng')) fail.push(`${name}: hóa đơn VC nhưng tiêu đề không ghi phản kháng`);
  const raw = (await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(mail)).message as Buffer;
  if (!raw.length) fail.push(`${name}: không dựng được MIME`);
}

if (sample) {
  console.log('Mẫu —', sample.subject);
  console.log('  từ:', `${sample.from.name} <${sample.from.address}>`, '· trả lời về:', (sample as any).replyTo);
  console.log('  đính kèm:', sample.attachments.map(a => a.filename).join(' | '));
  if (htmlOut) fs.writeFileSync(htmlOut, sample.html);
}
if (fail.length) { console.error(`ĐỎ ${fail.length}:\n` + fail.slice(0, 15).join('\n')); process.exit(1); }
console.log('XANH — mọi XML dựng được thư đủ tiêu đề, người gửi theo công ty bán, mã tra cứu, tổng tiền, 3 đính kèm.');
