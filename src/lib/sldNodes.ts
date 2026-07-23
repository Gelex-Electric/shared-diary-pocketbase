/**
 * Đọc cây thiết bị sơ đồ một sợi từ PocketBase `sld_node` (Phương án B).
 *
 * Mô hình: mỗi thiết bị = 1 record, nối lên cha qua `parent` (self-relation) →
 * tạo thành CÂY. KHÔNG lưu toạ độ — ELK tự tính khi vẽ (xem elkLayout.ts).
 * Chỉ lưu `meter_no` làm KHOÁ; tên KH/HSN/role tra động từ `station_map`
 * (xem meterInfo.ts) → không lưu trùng, không lệch dữ liệu.
 */
import { fetchAll } from './pbData';

/** `disconnector` = dao cách ly (lưỡi dao hở, KHÔNG ô vuông như máy cắt).
 *  `earth` = dao tiếp địa — là NHÁNH RẼ NGANG xuống đất, không phải thiết bị nối tiếp;
 *  khi vẽ nó được tách khỏi ELK và bám vào trục của thiết bị cha. */
export type SldNodeType =
  | 'source' | 'transformer' | 'meter' | 'busbar' | 'breaker' | 'feeder'
  | 'disconnector' | 'earth';

export interface SldNodeRec {
  id: string;
  station_key: string;
  zone: string;
  type: SldNodeType;
  kind?: string;        // 'acb' | 'mccb' (khi type='breaker')
  label?: string;
  order_index?: number;
  meter_no?: string;
  parent?: string;      // id node cha ('' = gốc)
  /** Tên tủ/khoang bao quanh (vd 'Tủ MSB NX9'). Các node cùng `enclosure` được vẽ
   *  chung một khung bao — khung tự tính bbox sau layout, KHÔNG lưu toạ độ. */
  enclosure?: string;
}

/** Tập station_key đã có sơ đồ kỹ thuật (để đánh dấu trong danh sách trạm). */
export async function fetchSldStationKeys(): Promise<Set<string>> {
  const rows = await fetchAll<{ station_key?: string }>('sld_node', { fields: 'station_key' });
  return new Set(rows.map(r => (r.station_key || '').trim()).filter(Boolean));
}

/** Toàn bộ node của 1 trạm, đã sắp theo order_index. */
export async function fetchSldNodes(stationKey: string): Promise<SldNodeRec[]> {
  return fetchAll<SldNodeRec>('sld_node', {
    filter: `station_key="${stationKey}"`,
    sort: 'order_index',
  });
}

/** Con trực tiếp của một node (theo thứ tự order_index). '' = gốc. */
export function childrenOf(rows: SldNodeRec[], parentId: string): SldNodeRec[] {
  return rows
    .filter(r => (r.parent || '') === parentId)
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
}
