/**
 * Tra phạm vi (KCN) của một điểm đo — dùng chung mọi màn Danh mục.
 *
 * Điểm đo thường lấy KCN theo TRẠM (khách thuê nhà xưởng có thể khai ở KCN khác
 * nơi đặt công tơ). Điểm ĐẦU NGUỒN (`role = dau_nguon`, schema v17 24/09/2026)
 * KHÔNG có trạm — lấy theo `zone` của chính nó, thiếu thì theo KCN của `line`.
 *
 * Trước đây mọi nơi tự viết `stations.find(s => s.id === p.station)?.zone`, gặp
 * điểm đầu nguồn là ra KCN rỗng và điểm đo "biến mất" khỏi các bảng lọc theo KCN.
 */
import type { Line, Point, Station } from './types';

export const isHeadPoint = (p?: Pick<Point, 'role'> | null): boolean => p?.role === 'dau_nguon';

export function pointZoneId(
  p: Point | undefined | null,
  stations: Station[] | Map<string, Station>,
  lines: Line[] = [],
): string | undefined {
  if (!p) return undefined;
  if (p.station) {
    const s = stations instanceof Map ? stations.get(p.station) : stations.find(x => x.id === p.station);
    if (s?.zone) return s.zone;
  }
  if (p.zone) return p.zone;
  if (p.line) return lines.find(l => l.id === p.line)?.zone;
  return undefined;
}

/**
 * Tên KCN của điểm đo có nằm trong danh sách KCN của tài khoản không (`users.area`
 * chứa TÊN đầy đủ, vd "KCN Tiền Hải"). So không phân biệt hoa thường / khoảng trắng
 * để lệch một dấu cách không làm Vận Hành mất việc.
 */
export function inAreas(zoneName: string, areas: string[]): boolean {
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  return !!zoneName && areas.some(a => n(a) === n(zoneName));
}
