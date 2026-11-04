/**
 * Danh sách công tơ cần TẢI SỐ: mọi công tơ HES trả về (`metterinfo.csv`).
 *
 * User chốt 04/11/2026: HES quyết định TẢI công tơ nào, Danh mục PB quyết định NHÂN HSN
 * nào và THUỘC khách nào. Trước đó danh sách tải lấy từ PB nên công tơ chưa khai bị mất
 * số hẳn (ngày 03/11: 159 công tơ trên HES, 118 có trong ChiSo_30min).
 *
 * Module THUẦN ngoài việc đọc file.
 */
import { existsSync, readFileSync } from 'node:fs';

const PATH = process.env.METTERINFO_PATH || 'public/metterinfo.csv';

/** Số công tơ trong `metterinfo.csv`. METER_NO là cột đầu, không bao giờ có dấu phẩy. */
export function hesSerials(path = PATH) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const iNo = (lines[0] ?? '').split(',').indexOf('METER_NO');
  if (iNo !== 0) throw new Error(`${path}: METER_NO phải là cột đầu tiên`);
  return [...new Set(lines.slice(1).map(l => l.slice(0, l.indexOf(',')).trim()).filter(Boolean))];
}
