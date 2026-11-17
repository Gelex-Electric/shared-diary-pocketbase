/**
 * GHI một điểm đo xuống PocketBase — thứ tự các bước là nghiệp vụ, đừng đảo.
 *
 * Tách khỏi `components/dm/CatalogEntry.tsx` ngày 17/11/2026 (plan
 * `2026-11-17-tach-catalog-entry.md`, đợt 3). Trước đó vòng "đổi chỗ / chuyển"
 * bị CHÉP HAI BẢN (điểm đầu nguồn và điểm thường); nay chỉ còn một.
 *
 * Repo được TRUYỀN VÀO (`SaveRepo`) thay vì import `./repo`, để test bằng repo
 * giả ghi lại thứ tự gọi: `npx tsx scripts/dm_test_point_save.ts`.
 *
 *   1. Đổi chỗ / chuyển số No với điểm đo dự kiến kia      (`reclaim`)
 *   2. Ghi điểm đo                                           (`points`)
 *   3. Ghi sổ mượn cho các dòng CHUYỂN                       (`borrows`)
 *   4. Đồng bộ vật tư của điểm đo theo form                  (`assets`, `devices`)
 * Đối chiếu nhu cầu (`runReconcile`) do component gọi sau, vì nó báo toast.
 */
import { parseRatio } from './hsn';
import { HAS_RATIO } from './supply';
import type { CatalogData } from './repo';
import type { Asset, AssetStatus, AssetType, Borrow, Device, Point } from './types';
import type { AssetRow } from './pointForm';
import type { PointCheck } from './pointCheck';

/** Phần repo mà việc lưu điểm đo dùng tới — bản thật là `lib/dm/repo`. */
export interface SaveRepo {
  points: {
    create: (data: Partial<Point>) => Promise<unknown>;
    update: (id: string, data: Partial<Point>) => Promise<unknown>;
  };
  assets: {
    create: (data: Partial<Asset>) => Promise<unknown>;
    update: (id: string, data: Partial<Asset>) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
  };
  devices: { update: (id: string, data: Partial<Device>) => Promise<unknown> };
  borrows: { create: (data: Partial<Borrow>) => Promise<unknown> };
}

export interface SavePointInput {
  repo: SaveRepo;
  d: CatalogData | null;
  /** Điểm đo đang sửa; `null` = tạo mới. */
  editingId: string | null;
  /** Bản ghi `dm_point` đã dựng sẵn ở component. */
  body: Partial<Point>;
  assetRows: AssetRow[];
  reclaim: PointCheck['reclaim'];
  /** Ngày ghi sổ mượn, `YYYY-MM-DD`. */
  today: string;
}

/** Ghi điểm đo + vật tư; trả về id điểm đo. */
export async function savePoint({
  repo, d, editingId, body, assetRows, reclaim, today,
}: SavePointInput): Promise<string> {
  const { assets, devices, borrows, points } = repo;

  /*
    ĐỔI CHỖ (hoặc chuyển) SỐ NO VỚI ĐIỂM ĐO DỰ KIẾN KIA — LÀM TRƯỚC.

    Phải trước `syncAssets`: cặp `(serial, point)` là UNIQUE, để nguyên
    bản ghi cũ thì PocketBase từ chối ngay khi ghi dòng mới ở đây.

    Có số cũ để đưa lại ⇒ ĐỔI CHỖ: bên kia nhận số cũ của dòng này, kèm
    đúng thiết bị tương ứng (loại và tỷ số nằm trên `dm_device`, không
    phải trên lần lắp).
    Không có ⇒ CHUYỂN: gỡ dòng bên kia, vì không còn gì để trả lại.
  */
  for (const b of reclaim) {
    if (!b.swapTo) { await assets.remove(b.asset.id); continue; }
    const dev = (d?.devices ?? []).find(x => x.serial.trim() === b.swapTo);
    await assets.update(b.asset.id, {
      serial: b.swapTo,
      ...(dev ? {
        device: dev.id, type: dev.type,
        ratio_primary: dev.ratio_primary, ratio_secondary: dev.ratio_secondary,
      } : {}),
    });
    // Giữ chỗ đi theo thiết bị: số cũ nay dành cho điểm đo bên kia.
    if (dev) await devices.update(dev.id, { hold_point: b.asset.point ?? '' });
  }

  const rec = editingId
    ? await points.update(editingId, body)
    : await points.create(body);
  const pointId = (rec as { id: string }).id;

  /*
    Ghi SỔ MƯỢN cho các dòng CHUYỂN về đây (luồng cấp vật tư đợt 2, 26/10/2026):
    điểm đo kia mất vật tư dự kiến nên phải được bù sau. Đổi chỗ thì hai bên
    đều nhận lại một thiết bị — không ai mất — nên không ghi.
  */
  for (const b of reclaim) {
    if (b.swapTo || !b.asset.point || b.asset.point === pointId) continue;
    const dev = b.asset.device
      || (d?.devices ?? []).find(x => x.serial.trim() === b.serial)?.id;
    if (!dev) continue;
    await borrows.create({
      device: dev, from_point: b.asset.point, to_point: pointId,
      borrowed_at: today, reason: 'Chuyển ở form điểm đo',
    });
  }

  // Vật tư lưu sau vì cần id điểm đo; lỗi ở đây sẽ báo nguyên văn từ PB
  // (thường là trùng số No với vật tư đang gắn ở điểm đo khác).
  await syncAssets(repo, d, pointId, assetRows);
  return pointId;
}

/**
 * Đồng bộ vật tư của một điểm đo theo những gì đang khai trên form.
 * Khớp bản ghi cũ theo (loại, pha): còn số No thì cập nhật, bỏ trống thì gỡ
 * bản ghi cũ đi — nhờ vậy sửa điểm đo không đẻ ra vật tư trùng.
 */
export async function syncAssets(
  repo: SaveRepo, d: CatalogData | null, pointId: string, assetRows: AssetRow[],
) {
  const { assets, devices } = repo;
  const rows = assetRows.filter(r => r.type && r.serial.trim());
  const keptIds = new Set(rows.map(r => r.id).filter(Boolean));

  // Dòng bị xoá khỏi bảng → gỡ bản ghi tương ứng.
  for (const old of d?.assets.filter(a => a.point === pointId) ?? []) {
    if (keptIds.has(old.id)) continue;
    await assets.remove(old.id);
    /*
      Gỡ luôn giữ chỗ nếu thiết bị đang dành cho chính điểm đo này. Bỏ sót
      thì thiết bị quay về kho mà vẫn mang nhãn "đang giữ cho <điểm đo>" của
      một dòng không còn tồn tại.
    */
    const dev = (d?.devices ?? []).find(x => x.serial.trim() === old.serial.trim());
    if (dev?.hold_point === pointId) await devices.update(dev.id, { hold_point: '' });
  }

  for (const r of rows) {
    const hasRatio = HAS_RATIO.includes(r.type as AssetType);
    const { primary, secondary } = parseRatio(r.ratio);
    const serial = r.serial.trim();

    /*
      MỖI SỐ NO PHẢI CÓ ĐÚNG MỘT THIẾT BỊ trong `dm_device`.

      Có sẵn trong kho thì DÙNG LẠI bản ghi đó — đây là chỗ dễ đẻ dữ liệu rác
      nhất: gõ lại số No ở form điểm đo mà tạo thiết bị thứ hai thì kho có hai
      dòng cùng số, `serial` UNIQUE sẽ chặn và người dùng nhận một câu lỗi
      không hiểu gì.

      Chưa có trong kho thì DỪNG (user chốt 28/09/2026): vật tư phải khai ở
      tab Kho vật tư trước. Trước đây chỗ này tạo thiết bị ngầm; `notInStock`
      đã chặn ở form, ném lỗi ở đây là chốt chặn cuối để không bao giờ lặng lẽ
      đẻ thiết bị mới nữa.
    */
    const dev = (d?.devices ?? []).find(x => x.serial.trim() === serial);
    if (!dev) {
      throw new Error(`Số No ${serial} chưa có trong Kho vật tư — khai thiết bị ở tab Kho vật tư trước.`);
    }

    /*
      GIỮ CHỖ đồng bộ ngay: dòng chưa có ngày treo nghĩa là thiết bị mới chỉ
      được dành cho điểm đo này, chưa lắp. Khai ngày treo thì bỏ giữ chỗ —
      nó đã có chỗ thật rồi, để cả hai là hai thông tin đá nhau.

      Trạng thái kho/đang treo KHÔNG ghi ở đây: `deriveDeviceStatus` tính lại
      từ các lần lắp, nên tháo xuống là tự về kho, không cần thao tác nào.
    */
    const hold = r.dateOn.trim() ? '' : pointId;
    if ((dev.hold_point ?? '') !== hold) await devices.update(dev.id, { hold_point: hold });

    const body = {
      serial,
      type: r.type as AssetType,
      device: dev.id,
      point: pointId,
      ratio_primary: hasRatio ? (primary ?? undefined) : undefined,
      ratio_secondary: hasRatio ? (secondary ?? undefined) : undefined,
      date_on: r.dateOn || '',
      date_off: r.dateOff || '',
      active: r.active,
      // `status` là vòng đời trong kho, `active` là "đang đo ở điểm đo này":
      // thiết bị tắt hoạt động coi như đã tháo khỏi điểm đo.
      status: (r.active ? 'dang_treo' : 'thao_go') as AssetStatus,
    };
    if (r.id) await assets.update(r.id, body);
    else await assets.create(body);
  }
}
