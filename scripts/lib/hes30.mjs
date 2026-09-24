/**
 * Đọc chỉ số 30 phút (`public/ChiSo_30min/<ngày>.csv`) và quy về LƯỚI 48 MỐC/NGÀY.
 *
 * Cột nguồn: `METER_NO, DATE_TIME, HSN, PG, BT, CD, TD, VC` — chỉ số LŨY KẾ, RAW
 * (chưa nhân HSN). `PG` = hữu công tổng (kWh), `VC` = vô công tổng (kVarh).
 *
 * Suy công suất từ HIỆU CHỈ SỐ, không dùng mẫu tức thời:
 *     P = ΔPG × HSN ÷ Δt(THỰC)      Q = ΔVC × HSN ÷ Δt(THỰC)
 *
 * BA CÁI BẪY đã trả giá ở đợt Pmax lộ (`logs/2026-09-22-pmax-theo-lo.md`), tránh sẵn:
 *
 *   1. **Chia cho 0,5h cố định** — công tơ KHÔNG báo đúng mỗi 30 phút. Một khoảng
 *      44 phút mà chia 0,5h thì vống 36%. Luôn chia Δt thực.
 *   2. **Không gom mốc** — đồng hồ lệch 1–2 phút nên một ngày ra 139 mốc khác nhau
 *      thay vì 48. Phải quy về lưới cố định.
 *   3. **Lấy max khi nhiều khoảng rơi vào một mốc** — đúng cho bài toán tìm ĐỈNH,
 *      SAI cho bài toán tích phân (tổn thất, sản lượng). Ở đây lấy TRUNG BÌNH CÓ
 *      TRỌNG SỐ theo phần chồng lấn.
 *
 * Hai con số trả về khác nhau về bản chất, đừng lẫn:
 *   · `slots[mốc] = {p, q}` — CÔNG SUẤT (kW/kVar) tại mốc, để tính ΔP rồi tích phân.
 *   · `energyKwh` — SẢN LƯỢNG ngày, cộng chính xác theo phần chồng lấn với ngày đó.
 *     Không suy ra từ `p × 0,5h`: khoảng 44 phút phủ 2 mốc mà nhân 0,5h mỗi mốc là
 *     tính thành 60 phút.
 *
 * Nửa đêm: user chốt 23/09/2026 **chia theo mốc** — khoảng vắt qua 00:00 thì phần
 * nào rơi ngày nào tính ngày đó. Vì vậy phải đọc kèm ngày TRƯỚC và ngày SAU: thiếu
 * ngày trước thì mốc 00:00 không có khoảng nào phủ, thiếu ngày sau thì mốc 23:30
 * cũng vậy — cả hai bị hiểu nhầm thành MẤT ĐIỆN.
 *
 * Module THUẦN ngoài việc đọc file: không gọi mạng, không đụng PocketBase.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SLOT_MIN = 30;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MIN;

const DIR = process.env.CHISO_30MIN_DIR || process.env.HES_30MIN_DIR || 'public/ChiSo_30min';

/** `0` → `'00:00'`, `47` → `'23:30'`. */
export const slotLabel = (i) =>
  `${String(Math.floor((i * SLOT_MIN) / 60)).padStart(2, '0')}:${(i * SLOT_MIN) % 60 === 0 ? '00' : '30'}`;

const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
};

/** `'YYYY-MM-DD'` cộng thêm `d` ngày. Dùng UTC để khỏi dính giờ địa phương. */
export function addDays(day, d) {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

/** `'2026-09-22 14:31:00'` → số phút tính từ 00:00 ngày `base`. Âm nếu trước đó. */
function minutesFrom(base, stamp) {
  const s = String(stamp || '').trim().replace('T', ' ');
  const day = s.slice(0, 10);
  const hh = Number(s.slice(11, 13));
  const mm = Number(s.slice(14, 16));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const dayDiff = Math.round(
    (new Date(`${day}T00:00:00Z`) - new Date(`${base}T00:00:00Z`)) / 86400000);
  return dayDiff * 24 * 60 + hh * 60 + mm;
}

/**
 * Đọc một file ngày. Trả `[]` khi chưa có file — ngày chưa lấy số là chuyện
 * bình thường (đầu dải, hoặc ngày bị prune), không phải lỗi.
 */
export function readDayFile(day, dir = DIR) {
  const f = path.join(dir, `${day}.csv`);
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(x => x.trim());
  if (lines.length < 2) return [];
  const H = lines[0].split(',').map(x => x.trim());
  const I = (n) => H.indexOf(n);
  const [iM, iT, iH, iPG, iVC] = [I('METER_NO'), I('DATE_TIME'), I('HSN'), I('PG'), I('VC')];
  if ([iM, iT, iH, iPG].some(i => i < 0)) {
    throw new Error(`${f}: thiếu cột bắt buộc (METER_NO, DATE_TIME, HSN, PG)`);
  }
  const out = [];
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    const serial = String(c[iM] ?? '').trim();
    if (!serial) continue;
    out.push({
      serial, stamp: String(c[iT] ?? '').trim(),
      hsn: num(c[iH]), pg: num(c[iPG]), vc: iVC >= 0 ? num(c[iVC]) : null,
    });
  }
  return out;
}

/**
 * Dựng chuỗi công suất theo mốc 30 phút cho MỘT ngày.
 *
 * @param {string} day `YYYY-MM-DD`
 * @param {{dir?: string}} [opt]
 * @returns {{day: string, meters: Map<string, {
 *   hsn: number, slots: Map<number, {p: number, q: number}>,
 *   energyKwh: number, energyKvarh: number, covered: number, regress: number
 * }>, missingFiles: string[]}}
 */
export function buildDaySeries(day, opt = {}) {
  const dir = opt.dir || DIR;
  const prevDay = addDays(day, -1), nextDay = addDays(day, 1);
  const missingFiles = [];
  const rows = [];
  let prevDayMissing = false, nextDayMissing = false;
  for (const d of [prevDay, day, nextDay]) {
    const r = readDayFile(d, dir);
    if (r.length === 0) {
      if (d === prevDay) prevDayMissing = true;
      else if (d === nextDay) nextDayMissing = true;
      else missingFiles.push(d);
    }
    rows.push(...r);
  }

  /* Gom theo công tơ rồi sắp theo thời gian. Một công tơ có thể đổi HSN giữa
     chừng (thay TI): lấy HSN của bản đọc ĐẦU mỗi khoảng, không lấy chung cả ngày. */
  const byMeter = new Map();
  for (const r of rows) {
    const t = minutesFrom(day, r.stamp);
    if (t === null || r.pg === null) continue;
    if (!byMeter.has(r.serial)) byMeter.set(r.serial, []);
    byMeter.get(r.serial).push({ t, hsn: r.hsn, pg: r.pg, vc: r.vc });
  }

  const DAY_MIN = 24 * 60;
  const meters = new Map();

  for (const [serial, list] of byMeter) {
    list.sort((a, b) => a.t - b.t);
    /* Tích luỹ theo mốc: tổng (giá trị × phần chồng lấn) và tổng phần chồng lấn,
       để cuối cùng chia ra TRUNG BÌNH CÓ TRỌNG SỐ. */
    const acc = new Map();
    let energyKwh = 0, energyKvarh = 0, regress = 0, hsnSeen = null;

    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const dtMin = b.t - a.t;
      if (dtMin <= 0) continue;                    // trùng mốc hoặc lùi giờ

      const hsn = a.hsn ?? b.hsn;
      if (!(hsn > 0)) continue;                    // chưa khai HSN → không quy đổi được
      if (hsnSeen === null) hsnSeen = hsn;

      const dPg = b.pg - a.pg;
      if (!(dPg >= 0)) { regress++; continue; }    // công tơ reset/thay → bỏ khoảng

      const dtH = dtMin / 60;
      const p = (dPg * hsn) / dtH;
      const dVc = (a.vc !== null && b.vc !== null) ? b.vc - a.vc : null;
      const q = dVc !== null && dVc >= 0 ? (dVc * hsn) / dtH : 0;

      /* Rải cho MỌI mốc mà khoảng này phủ qua, theo đúng phần chồng lấn. */
      const from = Math.max(0, Math.floor(a.t / SLOT_MIN));
      const to = Math.min(SLOTS_PER_DAY - 1, Math.floor((b.t - 1) / SLOT_MIN));
      for (let s = from; s <= to; s++) {
        const s0 = s * SLOT_MIN, s1 = s0 + SLOT_MIN;
        const overlap = Math.min(b.t, s1) - Math.max(a.t, s0);
        if (overlap <= 0) continue;
        const cur = acc.get(s) || { wp: 0, wq: 0, w: 0 };
        cur.wp += p * overlap; cur.wq += q * overlap; cur.w += overlap;
        acc.set(s, cur);
      }

      /* Sản lượng: chỉ phần chồng lấn với CHÍNH ngày này (chia theo mốc ở nửa đêm). */
      const inDay = Math.min(b.t, DAY_MIN) - Math.max(a.t, 0);
      if (inDay > 0) {
        energyKwh += p * (inDay / 60);
        energyKvarh += q * (inDay / 60);
      }
    }

    const slots = new Map();
    for (const [s, v] of acc) {
      if (v.w <= 0) continue;
      slots.set(s, { p: v.wp / v.w, q: v.wq / v.w });
    }
    meters.set(serial, {
      hsn: hsnSeen ?? 0, slots, energyKwh, energyKvarh,
      covered: slots.size, regress,
    });
  }

  /*
    CẢNH BÁO CHO CALLER — thiếu file hàng xóm là mất mốc ở RÌA ngày, âm thầm:

      · thiếu ngày TRƯỚC  → mốc 00:00 không có khoảng nào phủ;
      · thiếu ngày SAU    → mốc 23:30 không có khoảng nào phủ.

    Cái thứ hai xảy ra MỖI NGÀY trong pipeline: lúc tính tổn thất cho "hôm qua"
    thì file của hôm nay chưa được ghi. Hụt 30 phút/ngày ≈ 2% sản lượng lẫn tổn
    thất — đủ lớn để làm sai %TT mà vẫn trông hợp lý. Cách xử lý (ở lõi tính):
    mỗi lần chạy tính LẠI cả ngày hôm kia, lúc đó file hàng xóm đã đủ. Khử trùng
    theo khoá (CODE, DATE) nên ghi đè an toàn.

    KHÔNG tự bịa số cho mốc rìa: không có chỉ số thì không biết nửa giờ đó tiêu
    thụ bao nhiêu, đoán bằng nhịp trước đó là tạo dữ liệu không có thật.
  */
  return { day, meters, missingFiles, prevDayMissing, nextDayMissing };
}
