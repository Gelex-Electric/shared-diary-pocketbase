/**
 * Dựng + gửi thư hóa đơn tiền điện (trang "Hóa đơn điện tử") — plans/2026-10-01-trang-hoa-don-dien-tu.md.
 *
 * Mẫu thư dựa trên thư khối KD đang gửi tay (01/10/2026): giữ giọng văn, bố cục, chữ ký đỏ/nghiêng;
 * thêm bảng tóm tắt (mã KH, số HĐ, kỳ, tổng tiền, thông tin tra cứu). Tên công ty / địa chỉ / MST
 * lấy theo CÔNG TY BÁN của chính hóa đơn (GELEX hoặc GELEX Hưng Yên), không cố định.
 *
 * Biến môi trường: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (bắt buộc);
 * Email LIÊN HỆ in trong thư + Reply-To = email CÔNG TY MẸ của KCN (`dm_zone.email_parent`, user chốt
 * 01/10/2026 — không dùng biến môi trường). KCN chưa khai thì bỏ dòng liên hệ.
 * KHÔNG ghi địa chỉ hộp thư nào vào code (repo PUBLIC).
 */
import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
function smtp(): Transporter {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error('Server chưa cấu hình SMTP_HOST / SMTP_USER / SMTP_PASS.');
  transporter ??= nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure: false, requireTLS: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ymd = (s?: string) => String(s ?? '').split('T')[0].split(' ')[0];
const dmy = (s?: string) => { const [y, m, d] = ymd(s).split('-'); return d ? `${d}/${m}/${y}` : ''; };
const money = (n: unknown) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0));
const pad2 = (n: unknown) => String(Number(n) || 0).padStart(2, '0');
/** Giá trị tag đầu tiên trong khối `<parent>…</parent>` của XML hóa đơn. */
const xmlIn = (xml: string, parent: string, tag: string) =>
  ((xml.split(`<${parent}>`)[1] ?? '').match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]?.trim() ?? '';

/** Bản ghi `einvoice` đủ trường để dựng thư. */
export interface EinvoiceForMail {
  BillId: string; LoaiHD: string; Month: number; Year: number; Term: number;
  StartDate?: string; EndDate?: string; KHMSHDon: string; KHHDon: string; SHDon: string; NLap?: string;
  MaTraCuu: string; MSTNBan: string; NBan: string; MKHang: string; NMua: string; TgTTTBSo: number;
  xml: string; xml_name: string;
}

export interface MailInput {
  inv: EinvoiceForMail;
  to: string[];
  bcc: string[];
  zoneName?: string;
  /** Email công ty mẹ của KCN — dòng "Mọi thắc mắc…", chữ ký và Reply-To. Rỗng thì bỏ. */
  contact: string[];
  noticePdf: Buffer;
  invoicePdf: Buffer;
}

export function buildInvoiceMail({ inv, to, bcc, zoneName, contact: contactList, noticePdf, invoicePdf }: MailInput) {
  const contact = contactList.join('; ');
  const contactLinks = contactList.map(e => `<a href="mailto:${esc(e)}"><i>${esc(e)}</i></a>`).join('; ');
  const isVC = inv.LoaiHD === 'VC';
  const loai = isVC ? 'tiền công suất phản kháng' : 'tiền điện';
  const thang = `tháng ${pad2(inv.Month)} năm ${inv.Year}`;
  const soHD = `${inv.KHHDon}/${Number(inv.SHDon) || inv.SHDon}`;
  const subject = `Thông báo ${loai} ${thang} – ${inv.MKHang} – HĐ ${soHD}`;
  const sellerAddr = xmlIn(inv.xml, 'NBan', 'DChi');
  const base = (inv.xml_name || `${inv.KHMSHDon}${inv.KHHDon}_${inv.SHDon}`).replace(/\.xml$/i, '');

  const td = 'border:1px solid #9ca3af;padding:6px 10px;font-family:Arial,sans-serif;font-size:13px;';
  const th = `${td}color:#4b5563;width:42%;`;
  const row = (k: string, v: string) => `<tr><td style="${th}">${k}</td><td style="${td}">${v}</td></tr>`;
  const ky = inv.StartDate && inv.EndDate ? ` (${dmy(inv.StartDate)} – ${dmy(inv.EndDate)})` : '';

  const html = `<div style="font-family:'Times New Roman',Times,serif;font-size:16px;color:#111827;line-height:1.6">
<p style="margin:0 0 12px"><b>Kính gửi: ${esc(inv.NMua)}</b></p>
<p style="margin:0 0 12px">${esc(inv.NBan)} xin trân trọng cảm ơn sự tin tưởng và hợp tác của Quý khách hàng trong thời gian qua.
Chúng tôi xin gửi bản ghi <b>Giấy báo ${loai} kèm theo Hóa đơn điện tử ${loai} ${thang}</b> của Quý khách hàng${zoneName ? ` tại ${esc(zoneName)}` : ''}.</p>
<table style="border-collapse:collapse;margin:4px 0 14px;min-width:420px">
${row('Mã khách hàng', esc(inv.MKHang))}
${row('Ký hiệu / số hóa đơn', `${esc(inv.KHMSHDon + inv.KHHDon)} / ${esc(inv.SHDon)}${inv.NLap ? ` · ngày lập ${dmy(inv.NLap)}` : ''}`)}
${row('Kỳ', `Kỳ ${inv.Term || 1} ${thang}${ky}`)}
${row('Tổng tiền thanh toán', `<b>${money(inv.TgTTTBSo)} đồng</b>`)}
${row('Tra cứu hóa đơn', `<a href="https://hddtes78portal.hilo.com.vn/Invoice/Search?taxcode=${esc(inv.MSTNBan)}">hddtes78portal.hilo.com.vn</a> · MST bên bán <b>${esc(inv.MSTNBan)}</b> · Mã nhận HĐ <b style="font-family:Consolas,monospace">${esc(inv.MaTraCuu)}</b>`)}
</table>
<p style="margin:0 0 4px">Đính kèm: Giấy báo ${loai} (PDF), Hóa đơn điện tử (PDF) và tệp hóa đơn điện tử gốc (XML).</p>
${contact ? `<p style="margin:0">Mọi thắc mắc xin vui lòng liên hệ qua email: ${contactLinks}</p>` : ''}
<p style="margin:0 0 24px">Trân trọng!</p>
<p style="margin:0;color:#dc2626;font-size:14px">${esc(String(inv.NBan).toUpperCase())}</p>
${sellerAddr ? `<p style="margin:0;font-style:italic;font-size:14px">${esc(sellerAddr)}</p>` : ''}
<p style="margin:0;font-style:italic;font-size:14px">MST: ${esc(inv.MSTNBan)}${contact ? ` · Email: ${esc(contact)}` : ''}</p>
</div>`;

  const text = [
    `Kính gửi: ${inv.NMua}`, '',
    `${inv.NBan} xin gửi Giấy báo ${loai} kèm theo Hóa đơn điện tử ${loai} ${thang} của Quý khách hàng${zoneName ? ` tại ${zoneName}` : ''}.`,
    `Mã KH: ${inv.MKHang} · Hóa đơn: ${inv.KHMSHDon}${inv.KHHDon}/${inv.SHDon} · Tổng tiền: ${money(inv.TgTTTBSo)} đồng`,
    `Tra cứu: https://hddtes78portal.hilo.com.vn — MST bên bán ${inv.MSTNBan}, Mã nhận HĐ ${inv.MaTraCuu}`,
    contact ? `Liên hệ: ${contact}` : '', '', 'Trân trọng!', inv.NBan,
  ].filter(l => l !== null).join('\n');

  return {
    from: { name: inv.NBan, address: process.env.SMTP_USER! },
    ...(contactList.length ? { replyTo: contactList } : {}),
    to, bcc, subject, html, text,
    attachments: [
      { filename: `${base} - Giay bao ${isVC ? 'CSPK' : 'tien dien'}.pdf`, content: noticePdf, contentType: 'application/pdf' },
      { filename: `${base} - Hoa don.pdf`, content: invoicePdf, contentType: 'application/pdf' },
      { filename: `${base}.xml`, content: Buffer.from(inv.xml, 'utf8'), contentType: 'application/xml' },
    ],
  };
}

export async function sendInvoiceMail(input: MailInput): Promise<{ messageId: string; accepted: string[] }> {
  const info = await smtp().sendMail(buildInvoiceMail(input));
  return { messageId: info.messageId, accepted: (info.accepted as unknown[]).map(String) };
}
