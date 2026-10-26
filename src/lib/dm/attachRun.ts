/**
 * GHI việc gắn thiết bị vào điểm đo theo `planAttach` (`attach.ts`).
 * Dùng chung cho Kho vật tư và Phân bổ vật tư.
 *
 * Thứ tự ghi cố ý:
 *   1. gỡ dòng dự kiến ở điểm đo kia + ghi sổ mượn (nếu có) — làm TRƯỚC, kẻo
 *      giữa chừng có lúc một thiết bị nằm hai nơi;
 *   2. tạo LẦN LẮP mới (không sửa lần lắp cũ: mỗi lần lắp là một dòng lịch sử);
 *   3. đồng bộ giữ chỗ: có ngày treo ⇒ bỏ giữ chỗ; dự kiến ⇒ giữ cho điểm đo này.
 * Tuần tự, không `Promise.all`: lỗi giữa chừng thì biết đã ghi tới đâu.
 */
import { assets as assetRepo, borrows as borrowRepo, devices as deviceRepo } from './repo';
import type { AttachMove } from './attach';
import type { Device } from './types';

const today = () => new Date().toISOString().slice(0, 10);

export async function runAttach(
  picked: Device[], pointId: string, dateOn: string, moves: AttachMove[],
  /** Lý do ghi vào sổ mượn khi có thiết bị chuyển từ điểm đo khác. */
  reason = '',
  /** Báo số thiết bị đã gắn xong — để thông báo lỗi "dừng sau n thiết bị". */
  onProgress?: (n: number) => void,
): Promise<number> {
  for (const m of moves) {
    await assetRepo.remove(m.assetId);
    await borrowRepo.create({
      device: m.device, from_point: m.fromPoint, to_point: pointId,
      borrowed_at: today(), reason,
    });
  }
  let n = 0;
  for (const d of picked) {
    await assetRepo.create({
      serial: d.serial, type: d.type, device: d.id, point: pointId,
      ratio_primary: d.ratio_primary, ratio_secondary: d.ratio_secondary,
      date_on: dateOn || '', active: true, status: dateOn ? 'dang_treo' : 'kho',
    });
    const hold = dateOn ? '' : pointId;
    if ((d.hold_point ?? '') !== hold) await deviceRepo.update(d.id, { hold_point: hold });
    onProgress?.(++n);
  }
  return n;
}
