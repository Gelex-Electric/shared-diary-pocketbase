#!/usr/bin/env node
/**
 * Gửi MỘT mail thử qua SMTP Microsoft 365, đính kèm 1 file XML + 1 file PDF mẫu.
 * Mục đích: kiểm tra mailbox công ty có cho phép SMTP AUTH không, trước khi làm
 * tính năng gửi mail thật. Viết bằng Node để chạy được trên cả hai máy.
 *
 * Biến môi trường (KHÔNG ghi mật khẩu vào file/chat):
 *   SMTP_PASS   (bắt buộc) mật khẩu hoặc App Password của mailbox gửi
 *   MAIL_TO     (bắt buộc) người nhận — khi thử nên là hộp thư của chính bạn
 *   SMTP_HOST   mặc định smtp.office365.com
 *   SMTP_PORT   mặc định 587 (STARTTLS)
 *   SMTP_USER   (bắt buộc) mailbox gửi — đặt ở biến môi trường Railway, không ghi vào repo (repo PUBLIC)
 *   MAIL_FROM   mặc định = SMTP_USER
 *   NO_ATTACH=1  gửi mail trơn, không đính kèm gì
 *   MAIL_SUBJECT  tiêu đề (mặc định: tiêu đề thử nghiệm)
 *   MAIL_HTML_FILE  file HTML làm nội dung thư (mặc định: một dòng chữ thử)
 *   XML_FILE / PDF_FILE đường dẫn file thật muốn đính kèm (bỏ trống = file mẫu)
 *
 * Chạy:  node scripts/send_test_mail.mjs
 * Cần:   npm i --no-save nodemailer   (chưa là dependency của app)
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import nodemailer from 'nodemailer';

const env = process.env;
const host = env.SMTP_HOST || 'smtp.office365.com';
const port = Number(env.SMTP_PORT || 587);
const user = env.SMTP_USER;
const from = env.MAIL_FROM || user;
const to = env.MAIL_TO;
const pass = env.SMTP_PASS;

if (!pass || !to || !user) {
  console.error('Thiếu biến môi trường: cần SMTP_USER, SMTP_PASS và MAIL_TO.');
  process.exit(1);
}

// PDF 1 trang tối giản, tự dựng (không cần thư viện) — chỉ để thử đính kèm.
function samplePdf() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // stream, điền bên dưới
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 14 Tf 20 50 Td (Mail thu - PDF dinh kem) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += `${String(off).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const sampleXml = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?>\n<Test><Noidung>Mail thu - XML dinh kem</Noidung></Test>\n',
  'utf8',
);

const attachments = [];
if (env.NO_ATTACH === '1') {
  // thử không đính kèm
} else if (env.XML_FILE) attachments.push({ filename: basename(env.XML_FILE), content: await readFile(env.XML_FILE), contentType: 'application/xml' });
else attachments.push({ filename: 'mau.xml', content: sampleXml, contentType: 'application/xml' });
if (env.NO_ATTACH === '1') {
  // thử không đính kèm
} else if (env.PDF_FILE) attachments.push({ filename: basename(env.PDF_FILE), content: await readFile(env.PDF_FILE), contentType: 'application/pdf' });
else attachments.push({ filename: 'mau.pdf', content: samplePdf(), contentType: 'application/pdf' });

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: false, // 587 = STARTTLS, không phải SSL ngay từ đầu
  requireTLS: true,
  auth: { user, pass },
});

try {
  await transporter.verify();
  console.log(`Đăng nhập SMTP OK (${host}:${port}, ${user}).`);
  const info = await transporter.sendMail({
    from,
    to,
    subject: env.MAIL_SUBJECT || '[Thử nghiệm] Mail tự động có đính kèm XML + PDF',
    text: 'Đây là mail thử từ app. Đính kèm: 1 file XML và 1 file PDF.',
    ...(env.MAIL_HTML_FILE ? { html: await readFile(env.MAIL_HTML_FILE, 'utf8') } : {}),
    attachments,
  });
  console.log('Đã gửi:', info.messageId, '→', info.accepted.join(', '));
} catch (e) {
  console.error('Lỗi gửi mail:', e.code || '', e.responseCode || '', e.response || e.message);
  if (/5\.7\.139|5\.7\.57|SmtpClientAuthentication|535/.test(String(e.response || e.message))) {
    console.error('→ Mailbox chưa bật SMTP AUTH, hoặc cần App Password / chuyển sang Graph API. Hỏi IT.');
  }
  process.exit(1);
}
