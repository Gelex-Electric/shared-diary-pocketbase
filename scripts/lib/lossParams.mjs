/**
 * Chọn thông số tổn hao (P0, Pk) cho một trạm — NGUỒN SỰ THẬT DUY NHẤT.
 *
 * Vì sao nằm ở `scripts/lib/` chứ không phải `src/lib/`: pipeline chạy trên
 * GitHub Actions KHÔNG `npm ci`, nên script phải là Node thuần không phụ thuộc
 * gì (`tsx` không có ở đó). Còn app thì import được file này nhờ `allowJs: true`
 * và alias `@/*` = gốc repo. Một bản dùng chung cho cả hai — form Danh mục xem
 * trước giá trị nào, script tính bằng đúng giá trị đó.
 *
 * Ba nguồn thông số, theo thứ tự ưu tiên (user chốt 23/09/2026):
 *   1. Cờ `mv_metering`  → trạm mua bán điện TRUNG THẾ, KHÔNG tính tổn thất.
 *   2. Cờ `auto_loss_param` → lấy TRUNG BÌNH P0/Pk của các trạm CÙNG `sdm_kva`
 *      đã có số thật. Không lưu giá trị, suy lại mỗi lần tính: khai thêm trạm
 *      có biên bản kiểm định thì ước lượng của mọi trạm cùng công suất tự tốt
 *      lên, và không ai nhầm số ước lượng là số đo.
 *   3. Số trong `p0_w` / `pk_w` của chính trạm đó (từ biên bản kiểm định).
 *
 * Module THUẦN: không gọi mạng, không đọc file, không import PocketBase — chạy
 * test bằng `node scripts/dm_test_loss_params.mjs`.
 */

/**
 * @typedef {Object} StationLike
 * @property {string} [code]
 * @property {number|string|null} [sdm_kva]
 * @property {number|string|null} [p0_w]
 * @property {number|string|null} [pk_w]
 * @property {boolean} [auto_loss_param]
 * @property {boolean} [mv_metering]
 */

/** Lý do một trạm không có thông số để tính. Dùng làm nhãn trong log. */
export const SKIP_TRUNG_THE = 'TRUNG_THE';
export const SKIP_THIEU_THONG_SO = 'THIEU_THONG_SO';
export const SKIP_KHONG_CO_MAU = 'KHONG_CO_MAU_CUNG_CONG_SUAT';

/** Số dương thì trả về số, còn lại trả `null`. '' và 0 đều coi như CHƯA KHAI. */
const pos = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Trạm này có dùng được làm MẪU để ước lượng cho trạm khác không?
 *
 * Điều kiện: có đủ `sdm_kva`, `p0_w`, `pk_w` THẬT và KHÔNG bật cờ tự động —
 * lấy trạm ước lượng làm mẫu cho trạm ước lượng khác là tự nhân bản phỏng đoán.
 * Cờ `mv_metering` KHÔNG loại: trạm trung thế vẫn là máy biến áp có nhãn thật,
 * chỉ là tổn thất của nó không tính cho mình.
 *
 * @param {StationLike} s
 */
export function isLossParamSample(s) {
  if (!s || s.auto_loss_param) return false;
  return pos(s.sdm_kva) !== null && pos(s.p0_w) !== null && pos(s.pk_w) !== null;
}

/**
 * Trung bình P0/Pk của các trạm CÙNG công suất.
 *
 * @param {StationLike[]} stations toàn bộ trạm (để tìm mẫu)
 * @param {number|string|null} sdmKva công suất cần tìm mẫu
 * @returns {{p0_w: number, pk_w: number, samples: number, codes: string[]}|null}
 *   `null` khi không có mẫu nào cùng công suất.
 */
export function estimateLossParams(stations, sdmKva) {
  const sdm = pos(sdmKva);
  if (sdm === null) return null;

  const mau = (stations || []).filter(s => isLossParamSample(s) && pos(s.sdm_kva) === sdm);
  if (mau.length === 0) return null;

  const tb = (f) => mau.reduce((a, s) => a + pos(s[f]), 0) / mau.length;
  /* Làm tròn 1 chữ số: P0/Pk đơn vị W, lẻ hơn thế là giả vờ chính xác. */
  const r1 = (x) => Math.round(x * 10) / 10;

  return {
    p0_w: r1(tb('p0_w')),
    pk_w: r1(tb('pk_w')),
    samples: mau.length,
    codes: mau.map(s => s.code || '(chưa có mã)'),
  };
}

/**
 * Thông số cuối cùng dùng để tính tổn thất cho MỘT trạm.
 *
 * @param {StationLike} station
 * @param {StationLike[]} stations toàn bộ trạm — cần cho nhánh ước lượng
 * @returns {{ok: true, sdmKva: number, p0W: number, pkW: number,
 *             src: 'nhan'|'uoc_luong', samples?: number, codes?: string[]}
 *           |{ok: false, reason: string, detail?: string}}
 */
export function resolveLossParams(station, stations) {
  if (!station) return { ok: false, reason: SKIP_THIEU_THONG_SO };

  /* Trung thế đứng TRƯỚC mọi kiểm tra khác: đây là chủ ý bỏ, không phải thiếu
     dữ liệu. Xếp nhầm vào nhóm lỗi thì mỗi lần soát lại phải giải thích lại. */
  if (station.mv_metering) return { ok: false, reason: SKIP_TRUNG_THE };

  const sdm = pos(station.sdm_kva);
  /* Không có Sdm thì hỏng cả hai nhánh: ΔP = P0 + Pk×(S/Sdm)² cần mẫu số này,
     và ước lượng cũng tìm mẫu theo chính công suất. */
  if (sdm === null) {
    return { ok: false, reason: SKIP_THIEU_THONG_SO, detail: 'chưa khai sdm_kva' };
  }

  if (station.auto_loss_param) {
    const est = estimateLossParams(stations, sdm);
    if (!est) {
      return {
        ok: false, reason: SKIP_KHONG_CO_MAU,
        detail: `không trạm nào ${sdm} kVA có P0/Pk thật`,
      };
    }
    return {
      ok: true, sdmKva: sdm, p0W: est.p0_w, pkW: est.pk_w,
      src: 'uoc_luong', samples: est.samples, codes: est.codes,
    };
  }

  const p0 = pos(station.p0_w);
  const pk = pos(station.pk_w);
  if (p0 === null || pk === null) {
    const thieu = [p0 === null && 'p0_w', pk === null && 'pk_w'].filter(Boolean);
    return { ok: false, reason: SKIP_THIEU_THONG_SO, detail: `chưa khai ${thieu.join(', ')}` };
  }

  return { ok: true, sdmKva: sdm, p0W: p0, pkW: pk, src: 'nhan' };
}
