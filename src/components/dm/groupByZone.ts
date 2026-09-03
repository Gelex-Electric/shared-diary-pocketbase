/**
 * Sắp xếp + gom nhóm cho 3 bảng danh mục (Trạm / Khách hàng / Điểm đo).
 *
 * THUẦN, không JSX, không gọi PocketBase — để `CatalogEntry.tsx` khỏi phình
 * thêm và để logic này kiểm chứng được bằng mắt ở một chỗ.
 *
 * Cách trình bày lấy đúng khuôn bảng lấy chỉ số HES
 * (`components/hes/HesManualSectionCards.tsx`): mỗi KCN một dòng tiêu đề màu,
 * dưới nó là các dòng thuộc KCN đó. Màu lấy từ `lib/kcnColors.ts`, không tự chế.
 */
import type { Zone } from '../../lib/dm/types';

/** Bản ghi chưa có KCN cha thì xếp vào nhóm cuối cùng này (`zone = null`). */
export interface ZoneGroup<T> {
  zone: Zone | null;
  rows: T[];
}

/**
 * Xếp theo Mã khách hàng tăng dần. So sánh có `numeric` để KCNTH-2 đứng trước
 * KCNTH-10 (so chuỗi thuần sẽ ra ngược). Bản ghi chưa có MKH dồn xuống cuối
 * thay vì lẫn lên đầu.
 */
export function sortByMkh<T>(items: T[], mkhOf: (x: T) => string | undefined): T[] {
  return [...items].sort((a, b) => {
    const ma = mkhOf(a) ?? '';
    const mb = mkhOf(b) ?? '';
    if (!ma !== !mb) return ma ? -1 : 1;
    return ma.localeCompare(mb, 'vi', { numeric: true });
  });
}

/**
 * Xếp theo MÃ (mã trạm, mã điểm đo) tăng dần — cùng cách so sánh với
 * `sortByMkh`: `numeric` để T2 đứng trước T10, bản ghi thiếu mã dồn xuống cuối.
 *
 * Bảng điểm đo dùng hàm này thay vì `sortByMkh` (user chốt 22/08/2026): mã điểm
 * đo đã bắt đầu bằng hậu tố KCN rồi tới tên tắt khách hàng, nên xếp theo mã thì
 * các điểm đo của cùng một khách vẫn đứng liền nhau, mà thứ tự lại khớp với thứ
 * tự người dùng đọc trên chính cột đầu tiên của bảng.
 */
export function sortByCode<T>(items: T[], codeOf: (x: T) => string | undefined): T[] {
  return [...items].sort((a, b) => {
    const ca = codeOf(a) ?? '';
    const cb = codeOf(b) ?? '';
    if (!ca !== !cb) return ca ? -1 : 1;
    return ca.localeCompare(cb, 'vi', { numeric: true });
  });
}

/**
 * Gom theo KCN, GIỮ NGUYÊN thứ tự các phần tử bên trong mỗi nhóm — nên hãy
 * `sortByMkh` trước rồi mới gọi hàm này.
 *
 * Nhóm nào không có bản ghi nào thì bỏ hẳn khỏi kết quả (không hiện tiêu đề
 * rỗng). Nhóm "chưa gắn KCN" luôn nằm cuối.
 */
export function groupByZone<T>(
  items: T[],
  zoneIdOf: (x: T) => string | undefined,
  zones: Zone[],
): ZoneGroup<T>[] {
  const ordered = [...zones].sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));
  const groups: ZoneGroup<T>[] = [];

  for (const zone of ordered) {
    const rows = items.filter(x => zoneIdOf(x) === zone.id);
    if (rows.length) groups.push({ zone, rows });
  }

  const known = new Set(zones.map(z => z.id));
  const orphans = items.filter(x => {
    const id = zoneIdOf(x);
    return !id || !known.has(id);
  });
  if (orphans.length) groups.push({ zone: null, rows: orphans });

  return groups;
}
