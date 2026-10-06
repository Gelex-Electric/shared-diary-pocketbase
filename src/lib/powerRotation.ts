/**
 * Phân ca điều độ điện lực (main_power/sub_power) cho lịch trực tháng.
 *
 * Điều độ do Điện lực xếp, app không biết luật. Nhưng mỗi khu vực có các cặp điều độ cố định
 * xoay vòng theo chu kỳ P ngày (06/10/2026: Thuận Thành/Số 3/Yên Mỹ P=4, Tiền Hải P=5,
 * Phong Điền P=10). Nên: dò P từ lịch sử, rồi nối tiếp — ca (d, ca) lấy cặp của (d − P, ca).
 * Điện lực đổi lịch → P tự dò lại, không phải sửa code. Module THUẦN (test bằng `tsx`).
 */
import type { RosterSlot } from '../types';
import { addDays, normName, daysOfMonth, SHIFTS, emptySlot } from './dutyRotation';

type PowerSlot = Pick<RosterSlot, 'date' | 'shift' | 'main_power' | 'sub_power'>;
const key = (date: string, shift: string) => `${date}|${shift}`;

/** Chu kỳ xoay (ngày) khớp nhất trong lịch sử; null nếu không có quy luật rõ (< 60%). */
export function detectPowerPeriod(history: PowerSlot[], maxP = 14): number | null {
  const m = new Map(history.map(r => [key(r.date, r.shift), r]));
  let best: { P: number; rate: number } | null = null;
  for (let P = 1; P <= maxP; P++) {
    let ok = 0, tot = 0;
    for (const r of history) {
      if (!normName(r.main_power)) continue;
      const p = m.get(key(addDays(r.date, -P), r.shift));
      if (!p || !normName(p.main_power)) continue;
      tot++;
      if (normName(p.main_power) === normName(r.main_power) && normName(p.sub_power) === normName(r.sub_power)) ok++;
    }
    if (tot < 6) continue;
    // Ưu tiên P nhỏ nhất: bội số của P (2P, 3P…) khớp ngang nhau, không được vượt rõ rệt
    if (!best || ok / tot > best.rate + 0.02) best = { P, rate: ok / tot };
  }
  return best && best.rate >= 0.6 ? best.P : null;
}

/**
 * Phân điều độ cả tháng, nối tiếp chu kỳ từ `history` (các ca đã có gần nhất trước tháng —
 * có thể cách tháng một quãng, vd lịch sử dừng từ tháng 8).
 * Ca (d, ca) = cặp được NHIỀU PHIẾU nhất trong 3 ca cùng loại gần nhất cách d một bội số của P
 * (lùi tối đa tới hết lịch sử); hoà thì lấy ca gần nhất. Bỏ phiếu để một ca ghi nhầm trong lịch
 * sử không bị chép lặp lại mỗi P ngày (sự cố mô phỏng Tiền Hải 11/2026).
 * Không dò được chu kỳ → mọi ô trống (người lập tự chọn) và `period = null`.
 */
export function buildMonthPower(history: PowerSlot[], month: string): { slots: PowerSlot[]; period: number | null } {
  const P = detectPowerPeriod(history);
  const days = daysOfMonth(month);
  if (!P) return { slots: days.flatMap(d => SHIFTS.map(s => emptySlot(d, s))), period: null };
  const m = new Map<string, PowerSlot>(history.filter(r => normName(r.main_power)).map(r => [key(r.date, r.shift), r]));
  const earliest = history.reduce((min, r) => (r.date < min ? r.date : min), days[0]);
  const slots: PowerSlot[] = [];
  for (const date of days) {
    for (const shift of SHIFTS) {
      const votes = new Map<string, { src: PowerSlot; n: number; near: number }>();
      let found = 0;
      for (let k = 1; found < 3 && addDays(date, -k * P) >= earliest; k++) {
        const src = m.get(key(addDays(date, -k * P), shift));
        if (!src) continue;
        found++;
        const id = `${normName(src.main_power)}|${normName(src.sub_power)}`;
        const v = votes.get(id) ?? { src, n: 0, near: k };
        v.n++;
        votes.set(id, v);
      }
      const best = [...votes.values()].sort((a, b) => b.n - a.n || a.near - b.near)[0]?.src;
      const slot = { date, shift, main_power: best?.main_power.trim() ?? '', sub_power: best?.sub_power.trim() ?? '' };
      slots.push(slot);
      if (slot.main_power) m.set(key(date, shift), slot);
    }
  }
  return { slots, period: P };
}
