/**
 * Đối chiếu SẢN LƯỢNG PHỤ TRỪ — module THUẦN.
 *
 * Điểm đo chính đo cả phần điện mà các điểm đo phụ dùng, nên hóa đơn của nó
 * TRỪ ra phần đó ở các cột `phu_BT / phu_CD / phu_TD`. Phần trừ ấy phải đúng
 * bằng sản lượng các điểm đo phụ trong CÙNG kỳ. Lệch nghĩa là hoặc khai thiếu
 * điểm đo phụ, hoặc bên hóa đơn trừ nhầm — cả hai đều làm sai tổn thất.
 *
 * Luật kiểm chứng trên dữ liệu thật 25/08/2026, ca `YM.KIMTIN.T2.3000kVA.ECHO`
 * kỳ 01–10/08/2026: hóa đơn chính ghi phụ trừ BT/CĐ/TĐ = 20948/6060/3124, hóa
 * đơn của điểm phụ `…UNITED` ghi sản lượng đúng ba số đó.
 *
 * ⚠️ CHỈ xét điểm đo ĐANG VẬN HÀNH — xem `buildMainsWithSubs` bên dưới.
 *
 * ⚠️ CHỈ đối chiếu hóa đơn HỮU CÔNG (`LoaiHD = 'HC'`). Cột `phu_VC` là phần vô
 * công trừ ra, nhưng điểm đo phụ thường không phát hành hóa đơn VC riêng nên
 * không có gì để so — kiểm phần đó sẽ báo sai hàng loạt.
 */

import { dmyRange } from './lifecycle';

/** Các cột hóa đơn mà module này cần. */
export interface InvoiceUsage {
  SCT: string;
  StartDate?: string;
  EndDate?: string;
  LoaiHD?: string;
  SL_BT?: number;
  SL_CD?: number;
  SL_TD?: number;
  phu_BT?: number;
  phu_CD?: number;
  phu_TD?: number;
}

/** Một điểm đo chính kèm các điểm đo phụ treo dưới nó. */
export interface MainWithSubs {
  /** Mã điểm đo chính, để hiện trong cảnh báo. */
  code: string;
  /** Số công tơ của điểm đo chính (gồm cả cái đã tháo — kỳ cũ vẫn cần đối chiếu). */
  serials: string[];
  subs: { code: string; serials: string[] }[];
}

export interface Usage { bt: number; cd: number; td: number }

export interface SubDeductIssue {
  /** Mã điểm đo chính. */
  code: string;
  /** Quãng của THÁNG CHỐT, dạng dữ liệu `YYYY-MM-DD → YYYY-MM-DD`. */
  period: string;
  /** Cùng quãng đó dạng người đọc, kèm số hóa đơn nếu tháng bị cắt làm nhiều kỳ. */
  periodLabel: string;
  /** Phụ trừ ghi trên hóa đơn của điểm đo chính. */
  declared: Usage;
  /** Tổng sản lượng thực tế của các điểm đo phụ trong cùng kỳ. */
  actual: Usage;
  /** Điểm đo phụ không tìm thấy hóa đơn nào trong kỳ này. */
  missing: string[];
  /** Câu mô tả để hiện thẳng lên bảng rà soát. */
  note: string;
}

/* ------------------------------------------------------------------
   Dựng danh sách điểm đo chính ↔ điểm đo phụ
   ------------------------------------------------------------------ */

/** Điểm đo, rút gọn còn những trường phép đối chiếu này cần. */
export interface PointLite {
  id: string;
  code?: string;
  line_name?: string;
  role: string;
  parent_point?: string;
  status?: string;
}

/** Vật tư, rút gọn. */
export interface AssetLite {
  serial: string;
  type: string;
  point?: string;
}

/**
 * CHỈ xét điểm đo ĐANG VẬN HÀNH (user chốt 25/08/2026) — áp cho cả điểm đo
 * chính lẫn điểm đo phụ.
 *
 * Điểm đo "Dự kiến" chưa lắp xong nên đương nhiên chưa có hóa đơn; điểm đo
 * "Đã tháo gỡ" thì ngừng phát sinh từ lâu. Đem hai loại đó ra so sẽ đẻ ra hàng
 * loạt câu "không có hóa đơn cùng kỳ" hoàn toàn đúng nghiệp vụ nhưng vô nghĩa
 * với người đọc, và làm chìm mất những kỳ lệch thật.
 */
export const ACTIVE_STATUS = 'active';

/**
 * Gom điểm đo chính (đang vận hành, CÓ điểm đo phụ đang vận hành) kèm số công
 * tơ của từng bên. Để ở đây thay vì ở màn hình, để script kiểm chứng và app
 * dùng chung đúng một cách chọn.
 */
export function buildMainsWithSubs(points: PointLite[], assets: AssetLite[]): MainWithSubs[] {
  const codeOf = (p: PointLite) => p.code || p.line_name || p.id;
  const serialsOf = (id: string) => assets
    .filter(a => a.point === id && a.type === 'CONGTO')
    .map(a => a.serial);

  const out: MainWithSubs[] = [];
  for (const p of points) {
    if (p.role !== 'chinh' || p.status !== ACTIVE_STATUS) continue;
    const subs = points
      .filter(x => x.parent_point === p.id && x.status === ACTIVE_STATUS)
      .map(x => ({ code: codeOf(x), serials: serialsOf(x.id) }));
    if (!subs.length) continue;
    out.push({ code: codeOf(p), serials: serialsOf(p.id), subs });
  }
  return out;
}

const num = (v?: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ymd = (v?: string): string => (v ? String(v).slice(0, 10) : '');
const isHc = (i: InvoiceUsage): boolean => (i.LoaiHD ?? 'HC') === 'HC';

/**
 * Khoá gộp = THÁNG CHỐT (`YYYY-MM` của `EndDate`).
 *
 * Trước 25/08/2026 gộp theo đúng cặp ngày đầu–cuối của kỳ, nhưng hai bên KHÔNG
 * phải lúc nào cũng cùng kỳ: thay công tơ giữa tháng thì điểm đo chính bị cắt
 * làm hai hóa đơn (01–19/07 và 19–31/07) trong khi điểm đo phụ vẫn một hóa đơn
 * cả tháng. Ghép theo cặp ngày sẽ không tìm thấy gì và báo lệch oan — đúng ca
 * `TH.BQL.T2.160kVA` tháng 07/2026.
 *
 * Gộp theo tháng chốt thì 748+380 = 1128 khớp đúng sản lượng CSCC cả tháng.
 */
const monthOf = (i: InvoiceUsage): string => ymd(i.EndDate).slice(0, 7);

const zero = (): Usage => ({ bt: 0, cd: 0, td: 0 });
const add = (a: Usage, b: Usage): Usage => ({ bt: a.bt + b.bt, cd: a.cd + b.cd, td: a.td + b.td });
const total = (u: Usage): number => u.bt + u.cd + u.td;

/**
 * Sai lệch cho phép, tính bằng kWh trên từng khung giá.
 *
 * Bằng 0: hai con số này lấy từ cùng một bộ chỉ số công tơ nên phải khớp tuyệt
 * đối. Đặt biên độ chỉ để lọt lỗi thật.
 */
export const TOLERANCE = 0;

/**
 * So phụ trừ với tổng sản lượng điểm đo phụ, theo TỪNG THÁNG CHỐT của điểm đo
 * chính. Chỉ xét tháng nào có hóa đơn kết thúc từ `sinceYmd` trở đi (gọi với
 * mốc 40 ngày — xem `RECENT_DAYS` trong `lifecycle.ts`).
 *
 * Tháng đã được chọn thì lấy TRỌN các hóa đơn của tháng đó, kể cả hóa đơn kết
 * thúc trước mốc: so nửa tháng bên này với cả tháng bên kia thì đương nhiên lệch.
 *
 * Không có điểm đo phụ nào ⇒ trả về mảng rỗng: điểm đo thường không có gì để so.
 */
export function checkSubDeduction(
  main: MainWithSubs,
  invoices: InvoiceUsage[],
  sinceYmd: string,
): SubDeductIssue[] {
  if (!main.subs.length) return [];

  const mainSerials = new Set(main.serials);
  const mainRows = invoices.filter(i => mainSerials.has(i.SCT) && isHc(i) && ymd(i.StartDate));

  // Tháng nào có ít nhất một hóa đơn của điểm chính nằm trong tầm 40 ngày.
  const months = [...new Set(
    mainRows.filter(i => ymd(i.EndDate) >= sinceYmd).map(monthOf),
  )].filter(Boolean).sort();

  const issues: SubDeductIssue[] = [];
  for (const month of months) {
    const rows = mainRows.filter(i => monthOf(i) === month);
    const declared = rows.reduce(
      (acc, i) => add(acc, { bt: num(i.phu_BT), cd: num(i.phu_CD), td: num(i.phu_TD) }), zero());

    let actual = zero();
    const missing: string[] = [];
    for (const sub of main.subs) {
      const subRows = invoices.filter(i =>
        sub.serials.includes(i.SCT) && isHc(i) && monthOf(i) === month);
      if (!subRows.length) { missing.push(sub.code); continue; }
      for (const r of subRows) {
        actual = add(actual, { bt: num(r.SL_BT), cd: num(r.SL_CD), td: num(r.SL_TD) });
      }
    }

    const off = (a: number, b: number) => Math.abs(a - b) > TOLERANCE;
    const lech = off(declared.bt, actual.bt) || off(declared.cd, actual.cd) || off(declared.td, actual.td);

    // Thiếu hóa đơn điểm phụ mà phụ trừ cũng bằng 0 thì không có gì bất thường:
    // tháng đó điểm phụ chưa phát sinh, hóa đơn chính cũng không trừ gì.
    if (!lech && !(missing.length && total(declared) > 0)) continue;

    const from = rows.map(i => ymd(i.StartDate)).sort()[0];
    const to = rows.map(i => ymd(i.EndDate)).sort().pop();

    const parts: string[] = [];
    if (lech) {
      parts.push(
        `phụ trừ trên hóa đơn ${declared.bt}/${declared.cd}/${declared.td} kWh (BT/CĐ/TĐ) `
        + `≠ tổng sản lượng điểm đo phụ ${actual.bt}/${actual.cd}/${actual.td} `
        + `— lệch ${total(declared) - total(actual)} kWh`);
    }
    if (missing.length) {
      parts.push(`không có hóa đơn trong tháng của ${missing.join(', ')}`);
    }

    issues.push({
      code: main.code,
      period: `${from} → ${to}`,
      periodLabel: `${dmyRange(from, to)}${rows.length > 1 ? ` (${rows.length} hóa đơn)` : ''}`,
      declared, actual, missing,
      note: parts.join('; '),
    });
  }

  return issues;
}
