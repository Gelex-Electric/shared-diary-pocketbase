/**
 * Luật sửa BẢNG VẬT TƯ trong form điểm đo — module THUẦN (không React, không
 * PocketBase) để chạy test bằng `npx tsx scripts/dm_test_point_form.ts`.
 *
 * Tách khỏi `components/dm/CatalogEntry.tsx` ngày 17/11/2026 (plan
 * `2026-11-17-tach-catalog-entry.md`, đợt 1). Chỉ DỜI CHỖ, không đổi hành vi:
 * những gì trước đây component đọc ngầm qua closure (`d.devices`, `d.assets`,
 * `editingId`) nay truyền tường minh qua `RowCtx`.
 */
import { formatRatio } from './hsn';
import { HAS_RATIO } from './supply';
import { TI_PER_SET } from './pointStatus';
import type { Asset, AssetType, Device } from './types';
import type { SetOption } from './tutiPick';

/**
 * Một dòng vật tư trong bảng của form điểm đo.
 * `id` có giá trị = bản ghi `dm_asset` đã tồn tại (đang sửa); rỗng = dòng mới.
 * `key` chỉ để React phân biệt dòng, không lưu xuống PB.
 */
export interface AssetRow {
  key: string;
  id?: string;
  type: AssetType | '';
  serial: string;
  /** Gõ nguyên chuỗi `200/5`; tách ra 2 số khi lưu (`parseRatio`). */
  ratio: string;
  /** `YYYY-MM-DD`, khớp định dạng của `ui/DatePicker`. */
  dateOn: string;
  dateOff: string;
  /** Đang đo ở điểm đo này hay không — thiết bị cũ đã thay vẫn giữ trong bảng. */
  active: boolean;
  /**
   * Tỷ số MUỐN chọn — đặt khi bấm một bộ gợi ý theo HSN. Ô Số No của dòng mới
   * chỉ lọc thiết bị đúng tỷ số này. Không lưu xuống PB.
   */
  want?: string;
}

/** Dữ liệu danh mục mà các luật cần đọc. */
export interface RowCtx {
  devices: Device[];
  assets: Asset[];
  /** Điểm đo đang sửa; `null`/rỗng = đang thêm mới. */
  editingId?: string | null;
}

let rowSeq = 0;
/** Khoá React mới cho một dòng — dùng cả khi dựng dòng từ bản ghi đã lưu. */
export const newRowKey = () => `r${++rowSeq}`;
export const newRow = (type: AssetType | '' = ''): AssetRow =>
  ({ key: newRowKey(), type, serial: '', ratio: '', dateOn: '', dateOff: '', active: true });

/** `"2026-02-07 00:00:00.000Z"` → `"2026-02-07"`. */
export const ymdOf = (v?: string) => (v ?? '').slice(0, 10);

/** Chữ ký phần HSN + vật tư của form (bỏ `key`, `want` — chỉ là phụ trợ giao diện). */
export const hsnSig = (hsn: string, rows: AssetRow[]) =>
  JSON.stringify([hsn.trim(), rows.map(({ key: _k, want: _w, ...rest }) => rest)]);

/**
 * "Đang hoạt động" KHÔNG còn là ô người dùng gạt (user chốt 25/08/2026): có
 * ngày tháo tức là đã tháo, chưa có tức là còn treo. Hai nguồn sự thật cho cùng
 * một việc chỉ đẻ ra mâu thuẫn — cảnh báo "đang hoạt động nhưng đã khai ngày
 * tháo" từng phải tồn tại chính vì thế.
 */
export const normalizeActive = (rows: AssetRow[]): AssetRow[] =>
  rows.map(r => ({ ...r, active: !r.dateOff.trim() }));

/** Thiết bị trong kho mang số No này — nguồn của loại và tỷ số. */
export const deviceOf = (ctx: RowCtx, serial: string) => {
  const sn = serial.trim();
  return sn ? ctx.devices.find(x => x.serial.trim() === sn) : undefined;
};

/**
 * Vật tư CÙNG SỐ NO đang hoạt động ở điểm đo KHÁC — dùng để suy ngày tháo.
 *
 * Một số chế tạo chỉ có thể đang đo ở đúng một chỗ. Nếu nó đang treo ở nơi
 * khác mà giờ được khai vào điểm đo này, thì lần lắp ở đây phải đã KẾT THÚC
 * đúng vào ngày nó được treo ở nơi kia (user chốt 25/08/2026).
 */
export const liveElsewhere = (ctx: RowCtx, serial: string) => {
  const sn = serial.trim();
  if (!sn) return undefined;
  return ctx.assets.find(a =>
    a.serial === sn && a.active && a.point && a.point !== ctx.editingId && a.date_on);
};

/**
 * Dòng MỚI chọn thiết bị ĐANG TREO, HOẠT ĐỘNG ở điểm đo khác ⇒ KHÔNG được khai
 * ngày treo cho tới khi điểm đo cũ khai ngày tháo (user chốt 28/09/2026).
 * Chỉ được giữ ở dạng dự kiến. Dòng đã lưu không áp — đó là lịch sử cũ.
 */
export const lockedOn = (ctx: RowCtx, r: AssetRow) => !r.id && !!liveElsewhere(ctx, r.serial);

/**
 * Sửa một dòng rồi áp các luật nghiệp vụ lên những dòng còn lại.
 *
 * 1. **Tỷ số dùng chung theo loại** — 3 TI của một bộ luôn cùng tỷ số, TU
 *    cũng vậy. Nhập tỷ số cho một cái thì các dòng cùng loại CÒN TRỐNG tự
 *    điền theo; dòng đã có tỷ số khác thì KHÔNG đè, chỉ cảnh báo lệch.
 * 2. **Ngày treo lan cho cả bộ** — khai điểm đo lần đầu thì công tơ, 3 TI và
 *    đo xa đều lên cùng một ngày. Chỉ điền vào dòng CÒN TRỐNG ngày treo, nên
 *    vật tư lắp bổ sung sau này không bị đè.
 * 3. **Vật tư mới thay vật tư cũ** — dòng cùng loại đang treo từ TRƯỚC ngày
 *    treo của cái mới thì tự nhận ngày tháo = ngày treo của cái mới. Không
 *    đụng dòng cùng ngày (cả bộ lắp một lượt) và không đè ngày tháo đã khai.
 * 4. **Số No đang treo ở nơi khác** — điền sẵn ngày tháo = ngày treo bên đó.
 *
 * Cuối cùng CHUẨN HOÁ active = chưa có ngày tháo — xem ghi chú ở cột bảng.
 */
export const applyRowRules = (
  ctx: RowCtx, rows: AssetRow[], key: string, patch: Partial<AssetRow>,
): AssetRow[] => {
  const next = rows.map(r => (r.key === key ? { ...r, ...patch } : r));
  const me = next.find(r => r.key === key);
  if (!me || !me.type) return normalizeActive(next);
  const type = me.type as AssetType;

  // Đổi loại sang TI/TU mà chưa có tỷ số → thừa hưởng tỷ số của bộ cùng loại.
  let inherited = next;
  if (patch.type !== undefined && HAS_RATIO.includes(type) && !me.ratio.trim()) {
    const src = next.find(r => r.key !== key && r.type === type && r.ratio.trim());
    if (src) inherited = next.map(r => (r.key === key ? { ...r, ratio: src.ratio } : r));
  }

  // Nhập tỷ số → lan sang các dòng cùng loại đang bỏ trống.
  const spread = patch.ratio !== undefined && HAS_RATIO.includes(type) && patch.ratio.trim()
    ? inherited.map(r =>
        r.key !== key && r.type === type && !r.ratio.trim() ? { ...r, ratio: patch.ratio! } : r)
    : inherited;

  const on = me.dateOn.trim();

  // Vừa khai ngày treo → lan cho các dòng chưa có ngày treo nào (lắp cùng đợt),
  // rồi đóng các dòng cùng loại đang treo từ trước đó (thay thế vật tư).
  let dated = spread;
  if (patch.dateOn !== undefined && on) {
    dated = spread.map(r => {
      if (r.key === key) return r;
      // Dòng trắng tinh thì bỏ qua; dòng đã bắt đầu khai (có loại hoặc có số No)
      // thì coi là cùng đợt lắp.
      if (!r.type && !r.serial.trim()) return r;
      // Dòng mới mang thiết bị còn treo ở điểm đo khác: KHÔNG lan ngày treo —
      // phải đợi điểm đo cũ khai ngày tháo (xem `lockedOn`).
      if (lockedOn(ctx, r)) return r;
      // (2) cả bộ lên cùng ngày
      if (!r.dateOn.trim() && !r.dateOff.trim()) return { ...r, dateOn: on };
      // (3) cái cũ cùng loại nhường chỗ cho cái mới
      if (r.type === type && r.dateOn.trim() && r.dateOn.trim() < on && !r.dateOff.trim()) {
        return { ...r, dateOff: on };
      }
      return r;
    });
  }

  // (4) Số No này đang treo ở điểm đo khác ⇒ lần lắp ở đây đã kết thúc từ ngày
  // nó sang bên kia. Chỉ điền khi ô ngày tháo còn trống.
  // CHỈ cho dòng ĐÃ LƯU (ghi lại lịch sử). Dòng MỚI chọn thiết bị đang treo là
  // lần lắp SẮP TỚI: để trống cả hai ngày, khoá ngày treo (28/09/2026).
  const busy = me.id ? liveElsewhere(ctx, me.serial) : undefined;
  const withOff = busy && !me.dateOff.trim()
    ? dated.map(r => (r.key === key ? { ...r, dateOff: ymdOf(busy.date_on) } : r))
    : dated;

  /*
    (5) SỐ NO CÓ SẴN TRONG KHO ⇒ LẤY LOẠI VÀ TỶ SỐ TỪ THIẾT BỊ.

    Thiết bị đã khai một lần trong kho thì không việc gì phải gõ lại loại và
    tỷ số — vừa mất công vừa là cơ hội gõ lệch với bản ghi gốc.

    Dòng ĐÃ LƯU: chỉ điền vào ô CÒN TRỐNG — dữ liệu cũ giữ nguyên, chênh
    lệch tỷ số đã có cảnh báo riêng lo.

    Dòng MỚI (từ 28/09/2026 chỉ chọn được số No có trong kho): loại và tỷ số
    LUÔN theo thiết bị. Tỷ số là thuộc tính của thiết bị (schema v13), ô tỷ
    số của dòng mới chỉ đọc nên không có gì của người dùng để tôn trọng.
  */
  const fromStock = patch.serial !== undefined ? deviceOf(ctx, me.serial) : undefined;
  const stockRatio = fromStock ? formatRatio(fromStock.ratio_primary, fromStock.ratio_secondary) : '';
  const meDevice = deviceOf(ctx, me.serial);
  const filled = fromStock
    ? withOff.map(r => (r.key !== key ? r : r.id ? {
      ...r,
      type: r.type || fromStock.type,
      ratio: r.ratio.trim() || stockRatio,
    } : {
      ...r,
      type: fromStock.type,
      ratio: HAS_RATIO.includes(fromStock.type) ? stockRatio : '',
    }))
    // Dòng mới đổi sang loại khác loại của số No đang chọn ⇒ bỏ số No đó.
    : patch.type !== undefined && !me.id && me.serial.trim()
        && meDevice && meDevice.type !== type
      ? withOff.map(r => (r.key === key ? { ...r, serial: '', ratio: '' } : r))
      : withOff;

  // Vừa chọn thiết bị đang treo nơi khác cho dòng mới ⇒ bỏ ngày treo đã gõ.
  if (patch.serial !== undefined) {
    const mine = filled.find(r => r.key === key);
    if (mine && lockedOn(ctx, mine) && mine.dateOn) {
      return normalizeActive(filled.map(r => (r.key === key ? { ...r, dateOn: '' } : r)));
    }
  }

  return normalizeActive(filled);
};

/**
 * Chọn một bộ gợi ý theo HSN ⇒ thêm sẵn `TI_PER_SET` dòng TI (+ 1 dòng TU
 * nếu bộ có TU; cần thêm TU thì bấm "Thêm dòng"). Các dòng mang `want` để ô
 * Số No chỉ lọc thiết bị đúng tỷ số; tỷ số thật vẫn lấy từ thiết bị khi chọn.
 * Dòng trắng (chưa loại, chưa số No) có sẵn thì dọn đi cho gọn.
 */
export const applySet = (rows: AssetRow[], s: SetOption): AssetRow[] => {
  const mk = (type: AssetType, want: string): AssetRow => ({ ...newRow(type), want, ratio: want });
  const added = [
    ...Array.from({ length: TI_PER_SET }, () => mk('TI', s.ti)),
    ...(s.tu ? [mk('TU', s.tu)] : []),
  ];
  const kept = rows.filter(r => r.id || r.type || r.serial.trim());
  return normalizeActive([...kept, ...added]);
};

/** Thêm một dòng trống (có thể chọn sẵn loại) rồi áp luật như khi đổi loại. */
export const addRow = (ctx: RowCtx, rows: AssetRow[], type: AssetType | '' = ''): AssetRow[] => {
  const row = newRow(type);
  return applyRowRules(ctx, [...rows, row], row.key, { type });
};
