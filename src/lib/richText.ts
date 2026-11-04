/**
 * Richtext gọn dùng chung (user chốt 04/11/2026): đậm, nghiêng, gạch chân, danh sách, link.
 * Mọi HTML đi qua `sanitizeRichText` cả khi lưu lẫn khi hiển thị — dữ liệu PB ai đăng nhập cũng ghi được.
 */
import DOMPurify from 'dompurify';

const CONFIG = {
  ALLOWED_TAGS: ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
};

DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export const sanitizeRichText = (html: string) => DOMPurify.sanitize(html, CONFIG);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Mô tả cũ là chữ thường: thoát ký tự đặc biệt và giữ xuống dòng. */
export function richTextToHtml(value: string) {
  const isHtml = /<\/?(p|div|br|b|strong|i|em|u|ul|ol|li|a)\b[^>]*>/i.test(value);
  return sanitizeRichText(isHtml ? value : escapeHtml(value).replace(/\r?\n/g, '<br>'));
}

/** Ô soạn xoá hết vẫn còn `<br>` / thẻ rỗng — coi như chưa nhập. */
export function normalizeRichText(html: string) {
  const clean = sanitizeRichText(html);
  const box = document.createElement('div');
  box.innerHTML = clean;
  return box.textContent?.trim() ? clean : '';
}
