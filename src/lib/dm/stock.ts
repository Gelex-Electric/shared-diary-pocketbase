/**
 * Kho vật tư — module THUẦN, không mạng, không JSX.
 *
 * Chỗ đứng của nó trong mô hình: `Device` là THIẾT BỊ VẬT LÝ (mỗi số No một
 * bản ghi), `Asset` là MỘT LẦN LẮP. File này suy ra "thiết bị đang ở đâu, đang
 * giữ cho ai" từ hai thứ đó.
 */
import type { Asset, Device, DeviceStatus, Point } from './types';

/** Ngày ở PB là ISO; giao diện chỉ dùng phần ngày. */
const ymd = (v?: string): string => (v ?? '').slice(0, 10);

/**
 * Trạng thái SUY RA từ các lần lắp — nguồn sự thật, không tin cột `status` đã
 * lưu (nó chỉ là bản chụp lúc ghi).
 *
 * - Còn lần lắp ĐANG MỞ (có ngày treo, chưa có ngày tháo) ⇒ `dang_treo`.
 * - Không còn ⇒ `kho`. Kể cả thiết bị tháo từ lâu: đó chính là vòng đời user
 *   mô tả — tháo xuống về kho, rất lâu sau mới tái sử dụng hoặc thanh lý.
 *
 * `thanh_ly` KHÔNG suy được: đó là quyết định của người dùng, nên nếu đã lưu
 * thì giữ nguyên.
 */
export function deriveDeviceStatus(liquidatedAt: string | undefined, installs: Asset[]): DeviceStatus {
  if (ymd(liquidatedAt)) return 'thanh_ly';
  return installs.some(a => ymd(a.date_on) && !ymd(a.date_off)) ? 'dang_treo' : 'kho';
}

export interface StockRow {
  device: Device;
  status: DeviceStatus;
  /**
   * Điểm đo đang GIỮ CHỖ: đã khai thiết bị vào điểm đo nhưng chưa có ngày treo.
   * Thiết bị vẫn nằm trong kho về mặt vật lý, chỉ là đã có chỗ đến (user chốt
   * 28/08/2026 — hiện chung trong danh sách kho, thêm cột "đang giữ cho").
   */
  holdingPoint?: Point;
  /** Điểm đo đang lắp thật — chỉ có khi `status === 'dang_treo'`. */
  atPoint?: Point;
  /** Số lần đã lắp (kể cả lần đã tháo) — 0 = chưa từng ra hiện trường. */
  installCount: number;
  /** Ngày rời điểm đo gần nhất, để đếm nằm kho bao lâu. */
  lastOff: string;
  /**
   * VÒNG ĐỜI: các lần lắp đã có ngày treo, xếp theo thời gian.
   *
   * Đây chính là thứ màn "Luân chuyển vật tư" cũ hiển thị. Gộp vào đây vì một
   * thiết bị chỉ có MỘT vòng đời, mà tra ở hai màn khác nhau thì phải nhớ
   * sang màn nào — trong khi kho đã có sẵn danh sách thiết bị.
   */
  installs: { point?: Point; from: string; to: string }[];
  /**
   * KCN của thiết bị, để gom bảng kho theo khu như bảng điểm đo.
   *
   * Suy theo thứ tự CỤ THỂ DẦN LÙI: đang lắp ở đâu → đang giữ chỗ cho điểm đo
   * nào → KCN dự định (`hold_zone`). Hết cả ba thì chưa gắn KCN nào — hàng dự
   * phòng chung, xếp vào nhóm cuối.
   *
   * Điểm đo không mang `zone` trực tiếp mà mượn của trạm, nên phải tra qua
   * trạm — xem `zoneIdOf` truyền vào `buildStock`.
   */
  zoneId?: string;
}

/** Số lần lắp coi là ĐÃ TÁI SỬ DỤNG — dùng chung cho bộ lọc và câu nhắc. */
export const REUSE_MIN = 2;

/**
 * Dựng danh sách kho. Nhận cả `assets` lẫn `points` để không component nào phải
 * tự nối quan hệ.
 *
 * Nối theo `device` nếu có, ngược lại theo `serial` — giai đoạn chuyển tiếp còn
 * cả hai (xem plan 2026-08-28, bước 4 mới bỏ `serial` khỏi `Asset`).
 */
export function buildStock(
  devices: Device[], assets: Asset[], points: Point[],
  /** KCN của một điểm đo — điểm đo mượn KCN của trạm nên phải tra hộ. */
  zoneIdOf: (point?: Point) => string | undefined = () => undefined,
): StockRow[] {
  const pointById = new Map(points.map(p => [p.id, p]));
  const byDevice = new Map<string, Asset[]>();
  const bySerial = new Map<string, Asset[]>();
  for (const a of assets) {
    if (a.device) byDevice.set(a.device, [...(byDevice.get(a.device) ?? []), a]);
    const s = (a.serial ?? '').trim();
    if (s) bySerial.set(s, [...(bySerial.get(s) ?? []), a]);
  }

  return devices.map(d => {
    const rows = byDevice.get(d.id) ?? bySerial.get((d.serial ?? '').trim()) ?? [];
    const status = deriveDeviceStatus(d.liquidated_at, rows);
    const open = rows.find(a => ymd(a.date_on) && !ymd(a.date_off));
    /*
      Giữ chỗ đọc từ `hold_point` của chính thiết bị (schema v14).

      Nguồn cũ — dòng `dm_asset` có điểm đo mà chưa có ngày treo — vẫn còn
      trong dữ liệu và form điểm đo vẫn ghi ra, nên dùng làm phương án hai cho
      tới khi bước 3 dọn xong. Hai nguồn này đã được đồng bộ bằng
      `dm_backfill_hold_point.mjs`.
    */
    const legacyHold = rows.find(a => a.point && !ymd(a.date_on));
    const holdId = d.hold_point || legacyHold?.point;
    const offs = rows.map(a => ymd(a.date_off)).filter(Boolean).sort();
    return {
      device: d,
      status,
      atPoint: open?.point ? pointById.get(open.point) : undefined,
      holdingPoint: holdId ? pointById.get(holdId) : undefined,
      installCount: rows.filter(a => ymd(a.date_on)).length,
      lastOff: offs[offs.length - 1] ?? '',
      zoneId: (open?.point ? zoneIdOf(pointById.get(open.point)) : undefined)
        ?? (holdId ? zoneIdOf(pointById.get(holdId)) : undefined)
        ?? d.hold_zone
        ?? undefined,
      installs: rows
        .filter(a => ymd(a.date_on))
        .map(a => ({
          point: a.point ? pointById.get(a.point) : undefined,
          from: ymd(a.date_on), to: ymd(a.date_off),
        }))
        .sort((x, y) => x.from.localeCompare(y.from)),
    };
  });
}

/** Số ngày nằm kho tính tới `today`; chưa từng lắp thì tính từ ngày nhập. */
export function idleDays(row: StockRow, today: string): number {
  if (row.status !== 'kho') return 0;
  const from = row.lastOff || ymd(row.device.date_in);
  if (!from) return 0;
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : 0;
}

/** Ngưỡng nhắc "mua về mà quên lắp" — tiền chết nằm kho. */
export const IDLE_WARN_DAYS = 90;

/**
 * Tách danh sách số No người dùng dán vào ô nhập lô.
 *
 * Chấp nhận mọi kiểu ngắt mà bảng tính hay sinh ra: xuống dòng, tab, dấu phẩy,
 * chấm phẩy, khoảng trắng. Bỏ dấu nháy dẫn `'` — Excel hay thêm để giữ số dài
 * khỏi bị đổi sang dạng khoa học.
 *
 * Trả về danh sách đã BỎ TRÙNG, giữ nguyên thứ tự gõ, kèm số lần bị lặp để
 * giao diện nói rõ thay vì âm thầm nuốt.
 */
export function parseSerialList(text: string): { serials: string[]; duplicated: string[] } {
  const raw = (text ?? '')
    .split(/[\s,;]+/)
    .map(s => s.replace(/^'+/, '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const serials: string[] = [];
  const duplicated: string[] = [];
  for (const s of raw) {
    if (seen.has(s)) { if (!duplicated.includes(s)) duplicated.push(s); continue; }
    seen.add(s);
    serials.push(s);
  }
  return { serials, duplicated };
}

/**
 * Đoán loại từ DẠNG SỐ — chỉ ở chỗ chắc chắn, và chỉ để GỢI Ý.
 *
 * - GP-03 mang IMEI: 15 chữ số bắt đầu `869`.
 * - SIM mang ICCID:  19–20 chữ số bắt đầu `8984` (mã Việt Nam).
 *
 * KHÔNG đoán công tơ với TI: cả hai đều là 10 chữ số bắt đầu bằng `2`
 * (`2610323020` là công tơ, `2620400694` là TI). Script nạp SINTEC từng đoán
 * kiểu đó và biến cả bộ 3 TI 500/5 của MATIN thành 3 công tơ, kéo HSN về 1.
 * Hai dạng trên thì không nhầm được với gì khác nên mới dám gợi ý.
 */
export function guessType(serial: string): 'GP03' | 'SIM' | null {
  const s = (serial ?? '').trim();
  if (/^869\d{12}$/.test(s)) return 'GP03';
  if (/^8984\d{15,16}$/.test(s)) return 'SIM';
  return null;
}

/** Số No hợp lệ: chỉ chữ số, dài 8–20 — đủ bắt lỗi dán nhầm cột. */
export const SERIAL_RE = /^\d{8,20}$/;

/**
 * Tách một khối DÁN TỪ BẢNG TÍNH thành các dòng {số No, tỷ số}.
 *
 * Người dùng copy từ Excel nên mỗi dòng có thể là một cột (chỉ số No) hoặc
 * nhiều cột ngăn bằng tab. Lấy ô ĐẦU làm số No; ô nào có dạng `a/b` thì nhận
 * làm tỷ số, kể cả khi nó không ở cột thứ hai — thứ tự cột giữa các file không
 * giống nhau.
 */
export interface PastedRow {
  serial: string;
  ratio: string;
  /** Vì sao dòng này không dùng được; rỗng = hợp lệ. */
  problem: string;
}

export function parsePaste(text: string): PastedRow[] {
  const out: PastedRow[] = [];
  const seen = new Set<string>();
  for (const line of (text ?? '').split(/\r?\n/)) {
    const cells = line.split(/[\t;,]/).map(c => c.replace(/^'+/, '').trim()).filter(Boolean);
    if (!cells.length) continue;
    const serial = cells[0].replace(/\s+/g, '');
    const ratio = cells.slice(1).find(c => /^\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?$/.test(c)) ?? '';
    const problem = !SERIAL_RE.test(serial) ? 'số No phải là 8–20 chữ số'
      : seen.has(serial) ? 'trùng với dòng phía trên'
        : '';
    seen.add(serial);
    out.push({ serial, ratio: ratio.replace(/\s+/g, ''), problem });
  }
  return out;
}

/**
 * Số No đã tồn tại — chặn ở tầng ứng dụng TRƯỚC khi PocketBase chặn.
 *
 * `dm_device.serial` là UNIQUE nên PB cũng từ chối, nhưng câu nó trả về là
 * "Value must be unique" — chẳng nói được nó đang nằm ở đâu.
 */
export function findExisting(devices: Device[], serials: string[]): Map<string, Device> {
  const bySerial = new Map(devices.map(d => [(d.serial ?? '').trim(), d]));
  const hit = new Map<string, Device>();
  for (const s of serials) {
    const d = bySerial.get(s);
    if (d) hit.set(s, d);
  }
  return hit;
}
