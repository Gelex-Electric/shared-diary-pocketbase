/**
 * Phát hiện PHÁT NGƯỢC (hữu công chiều nhận) và DƯ BÙ (vô công chiều nhận) từ các
 * bản ghi `GetMeterDataByDate` của MỘT công tơ trong MỘT ngày.
 *
 * Hàm THUẦN — không gọi mạng, không đọc file — để test độc lập và để
 * `fetch_hes_index.mjs` gọi trên dữ liệu đã tải sẵn (không tốn thêm lời gọi API).
 *
 * Luật (user chốt 24/09/2026):
 *   · phát ngược — hữu công nhận TĂNG bất kỳ mức nào (> 0) là báo;
 *   · dư bù — vô công nhận ≥ DUBU_RATIO (10 %) × vô công GIAO cùng ngày VÀ > DUBU_MIN_KVARH
 *     (1.000 kVArh). 24/09: 10 % & ≥ 200 kVArh (~9 công tơ tháng 9). 25/09 user nâng lượng
 *     lên > 1.000 và GIỮ điều kiện 10 %. Vô công giao = 0 (tụ đóng cả ngày) ⇒ tỷ lệ vô cực.
 * Bước LÙI (thay công tơ, sai số làm tròn HES) KHÔNG được cộng vào — việc đó đã có
 * cảnh báo `lui` riêng.
 */

export const REVERSE_REGISTERS = {
  phatnguoc: { field: 'NEGACTIVE_KW_INDICATE_TOTAL',   register: 'Hữu công nhận – tổng', unit: 'kWh' },
  dubu:      { field: 'NEGACTIVE_KVAR_INDICATE_TOTAL', register: 'Vô công nhận – tổng',  unit: 'kVArh' },
};

/** Dư bù: vô công nhận / vô công giao ≥ ngưỡng này (user chốt 24/09, GIỮ LẠI 25/09/2026). */
export const DUBU_RATIO = Number(process.env.DUBU_RATIO || 0.1);
/** Dư bù: vô công nhận trong ngày (×HSN) phải LỚN HƠN mức này (user chốt 25/09/2026). */
export const DUBU_MIN_KVARH = Number(process.env.DUBU_MIN_KVARH || 1000);
const REACTIVE_GIAO = 'REACTIVE_KVAR_INDICATE_TOTAL';

const recTime = (r) => r?.DATE_TIME || r?.DATA_TIME || '';
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
/** Sai số dấu phẩy động khi trừ hai chỉ số 3 chữ số thập phân. */
const FLOAT_SLOP = 1e-9;
const hhmm = (t) => String(t).slice(11, 16);
const round3 = (x) => Math.round(x * 1000) / 1000;

/** Một thanh ghi → kết quả, hoặc null nếu không tăng. */
function scanOne(recs, field, hsn) {
  const pts = recs
    .map(r => ({ t: recTime(r), v: num(r[field]) }))
    .filter(p => p.t && p.v !== null)
    .sort((a, b) => a.t.localeCompare(b.t));
  if (pts.length < 2) return null;

  let raw = 0, fromTime = null, toTime = null, peak = null;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].v - pts[i - 1].v;
    if (d <= FLOAT_SLOP) continue;                 // đứng yên hoặc LÙI — không cộng
    raw += d;
    fromTime ??= pts[i - 1].t;                     // đầu khoảng có tăng đầu tiên
    toTime = pts[i].t;                             // cuối khoảng có tăng cuối cùng
    const val = d * hsn;
    if (!peak || val > peak.value + FLOAT_SLOP) peak = { value: round3(val), at: pts[i - 1].t };
  }
  if (raw <= FLOAT_SLOP) return null;
  return {
    fromIndex: pts[0].v, toIndex: pts[pts.length - 1].v,
    raw: round3(raw), value: round3(raw * hsn),
    fromTime, toTime, peak,
  };
}

/**
 * @param recs  bản ghi HES của một công tơ một ngày (thứ tự bất kỳ)
 * @param hsn   hệ số nhân (từ Danh mục)
 * @returns {{phatnguoc: object|null, dubu: object|null}} — null = KHÔNG báo
 *   mỗi mục: {fromIndex, toIndex, raw, value (×HSN), fromTime, toTime, peak:{value, at}, register, unit}
 *   dubu thêm: {giao (kVArh vô công giao cùng ngày), ratio (nhận/giao; Infinity khi giao = 0)}
 */
export function detectReverse(recs, hsn) {
  const h = Number(hsn);
  const out = {};
  for (const [kind, spec] of Object.entries(REVERSE_REGISTERS)) {
    const r = Number.isFinite(h) && h > 0 && Array.isArray(recs) ? scanOne(recs, spec.field, h) : null;
    out[kind] = r ? { ...r, register: spec.register, unit: spec.unit } : null;
  }
  if (out.dubu) {
    const giao = scanOne(recs, REACTIVE_GIAO, h)?.value ?? 0;
    const ratio = giao > 0 ? out.dubu.value / giao : Infinity;
    out.dubu = ratio + FLOAT_SLOP >= DUBU_RATIO && out.dubu.value > DUBU_MIN_KVARH + FLOAT_SLOP
      ? { ...out.dubu, giao, ratio } : null;
  }
  return out;
}

/** Ghi chú đỉnh cho dòng chi tiết cảnh báo: "đỉnh 188 kWh lúc 11:00". */
export function peakNote(res) {
  if (!res?.peak) return '';
  const v = res.peak.value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
  const peak = `đỉnh ${v} ${res.unit} lúc ${hhmm(res.peak.at)}`;
  if (res.ratio === undefined) return peak;
  const pct = Number.isFinite(res.ratio)
    ? `= ${Math.round(res.ratio * 100)}% vô công giao (${res.giao.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} kVArh)`
    : 'vô công giao = 0';
  return `${pct} · ${peak}`;
}

const KIND_TEXT = {
  phatnguoc: { title: 'Công tơ phát ngược lên lưới', what: 'hữu công chiều nhận tăng' },
  dubu: { title: 'Công tơ dư bù (vô công chiều nhận)', what: `vô công chiều nhận ≥ ${Math.round(DUBU_RATIO * 100)}% vô công giao và > ${DUBU_MIN_KVARH.toLocaleString('vi-VN')} kVArh` },
};

/**
 * Dựng tham số `raiseAlert` cho MỘT cảnh báo gộp của một ngày (`phatnguoc` hoặc `dubu`).
 * Dùng chung cho `fetch_hes_index.mjs` (hằng đêm) và `hes_scan_reverse.mjs --notify`.
 *
 * @param day   'YYYY-MM-DD'
 * @param hits  [{ m: công tơ từ liveMeters(), r: detectReverse(...)[kind] }]
 * @param shortNameOf (mkh) → tên tắt khách
 * @param zoneOf  gộp KCN (pb_alert.zoneOf)
 * @param kind  'phatnguoc' | 'dubu'
 * @returns tham số cho raiseAlert, hoặc null nếu không có ca nào
 */
export function buildReverseAlert(day, hits, shortNameOf, zoneOf, kind = 'phatnguoc') {
  const list = hits.filter(h => h?.r).sort((a, b) => b.r.value - a.r.value);
  if (!list.length) return null;
  const details = list.map(({ m, r }) => ({
    meter: m.serial,
    customer: shortNameOf(m.mkh),
    station: m.code ?? '',
    zone: m.zone ?? '',
    day,
    fromTime: String(r.fromTime).slice(11, 16),
    /* Mốc cuối rơi sang 00:00 hôm sau (quét có lấy thêm mốc đó) ⇒ ghi "24:00" —
       "00:00 → 00:00" đọc như khoảng rỗng. */
    toTime: String(r.toTime).slice(0, 10) > day ? '24:00' : String(r.toTime).slice(11, 16),
    register: r.register,
    fromIndex: r.fromIndex,
    toIndex: r.toIndex,
    value: r.value,
    unit: r.unit,
    note: peakNote(r),
  }));
  return {
    kind,
    title: KIND_TEXT[kind].title,
    /* message là khoá chống trùng cùng với kind+day — chỉ ghi số công tơ, không ghi
       lượng, để chạy lại sau khi HES bổ sung số không đẻ ra bản thứ hai. */
    message: `Ngày ${day}: ${list.length} công tơ có ${KIND_TEXT[kind].what} — `
      + list.map(({ m }) => `${m.serial} ${m.code ?? ''}`.trim()).join(', '),
    zone: zoneOf(list.map(h => h.m.zone ?? '')),
    meters: list.map(h => h.m.serial),
    details,
    day,
  };
}
