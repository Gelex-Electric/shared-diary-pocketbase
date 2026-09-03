/**
 * Phân loại kho vật tư theo VÒNG ĐỜI LẮP ĐẶT — module THUẦN.
 *
 * Trả lời ba câu hỏi vận hành (user chốt 25/08/2026):
 *
 *   1. Cái nào đã LUÂN CHUYỂN nhiều nơi   — lắp ở từ 2 điểm đo trở lên
 *   2. Cái nào đã THÁO XUỐNG mà chưa lắp lại — nằm không, có thể tái sử dụng
 *   3. Cái nào mới chỉ DỰ KIẾN            — khai rồi nhưng chưa có ngày treo
 *
 * Ba nhóm KHÔNG loại trừ nhau: một công tơ từng lắp 3 nơi và hiện đang nằm
 * không thì có mặt ở cả nhóm 1 lẫn nhóm 2. Cố ép mỗi vật tư vào đúng một nhóm
 * sẽ làm mất câu trả lời cho một trong hai câu hỏi.
 *
 * "Một lần lắp" = một bản ghi `dm_asset` CÓ NGÀY TREO. Ràng buộc duy nhất của
 * collection là `(serial, point)` nên mỗi lần lắp ở một điểm đo khác là một bản
 * ghi riêng — đếm bản ghi chính là đếm số lần luân chuyển.
 */

/** Bản ghi vật tư, rút gọn còn những trường phép phân loại này cần. */
export interface PoolAsset {
  id: string;
  serial: string;
  type: string;
  point?: string;
  date_on?: string;
  date_off?: string;
  active?: boolean;
  ratio_primary?: number;
  ratio_secondary?: number;
}

/** Một lần lắp của vật tư tại một điểm đo. */
export interface Install {
  id: string;
  pointId?: string;
  /** `YYYY-MM-DD`, rỗng nếu chưa khai. */
  from: string;
  to: string;
  active: boolean;
}

export interface PoolItem {
  serial: string;
  type: string;
  /** Tỷ số của bản ghi mới nhất — TI/TU mới có. */
  ratio?: string;
  /** Các lần lắp, xếp theo ngày treo tăng dần. */
  installs: Install[];
  /** Bản ghi chưa khai ngày treo (vật tư dự kiến). */
  plannedAt: Install[];
}

export interface Pool {
  /** Đã lắp ở từ `REUSE_MIN` điểm đo trở lên. */
  reused: PoolItem[];
  /** Đã từng lắp, hiện KHÔNG còn chỗ nào hoạt động. */
  idle: PoolItem[];
  /** Có bản ghi chưa khai ngày treo. */
  planned: PoolItem[];
}

/** Từ mấy lần lắp trở lên thì coi là đã tái sử dụng. */
export const REUSE_MIN = 2;

const ymd = (v?: string): string => (v ? String(v).slice(0, 10) : '');

const ratioOf = (a: PoolAsset): string | undefined =>
  a.ratio_primary != null || a.ratio_secondary != null
    ? `${a.ratio_primary ?? '?'}/${a.ratio_secondary ?? '?'}`
    : undefined;

export function buildPool(assets: PoolAsset[]): Pool {
  const bySerial = new Map<string, PoolAsset[]>();
  for (const a of assets) {
    if (!a.serial) continue;
    const list = bySerial.get(a.serial);
    if (list) list.push(a); else bySerial.set(a.serial, [a]);
  }

  const items: PoolItem[] = [];
  for (const [serial, rows] of bySerial) {
    const toInstall = (a: PoolAsset): Install => ({
      id: a.id, pointId: a.point, from: ymd(a.date_on), to: ymd(a.date_off), active: !!a.active,
    });
    const installs = rows.filter(a => ymd(a.date_on))
      .sort((x, y) => (ymd(x.date_on) < ymd(y.date_on) ? -1 : 1))
      .map(toInstall);
    const plannedAt = rows.filter(a => !ymd(a.date_on)).map(toInstall);

    items.push({
      serial,
      type: rows[0].type,
      ratio: ratioOf(rows[rows.length - 1]),
      installs,
      plannedAt,
    });
  }

  const bySerialAsc = (a: PoolItem, b: PoolItem) =>
    a.serial.localeCompare(b.serial, 'vi', { numeric: true });

  return {
    // Nhiều lần luân chuyển đứng trước — đó là cái đáng xem nhất.
    reused: items.filter(x => x.installs.length >= REUSE_MIN)
      .sort((a, b) => b.installs.length - a.installs.length || bySerialAsc(a, b)),
    idle: items.filter(x => x.installs.length > 0 && !x.installs.some(i => i.active))
      // Tháo gần đây nhất lên trước: đó là cái sẵn sàng dùng lại.
      .sort((a, b) => {
        const last = (x: PoolItem) => x.installs.map(i => i.to).sort().pop() ?? '';
        return last(b).localeCompare(last(a)) || bySerialAsc(a, b);
      }),
    planned: items.filter(x => x.plannedAt.length > 0).sort(bySerialAsc),
  };
}
