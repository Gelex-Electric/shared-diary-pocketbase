/**
 * Gợi ý trực điều độ điện lực (main_power/sub_power) từ lịch sử ca trực.
 *
 * Điều độ không có danh sách nhân sự trong app — tên do người nhập gõ tay. Nhưng mỗi khu vực
 * có các cặp điều độ cố định xoay vòng theo chu kỳ P ngày (06/10/2026: Thuận Thành/Số 3/Yên Mỹ
 * P=4, Tiền Hải P=5, Phong Điền P=10). Nên: dò P từ lịch sử, rồi lấy cặp của cùng ca ở ngày
 * cách đúng k·P ngày. Đổi lịch điều độ → P tự dò lại, không phải sửa code.
 */
import type { Handover } from '../types';

const norm = (s?: string) => (s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

export const addDays = (date: string, k: number) => {
  const x = new Date(`${date}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + k);
  return x.toISOString().slice(0, 10);
};

const key = (date: string, shift: string) => `${date}|${shift}`;

/** Chu kỳ xoay (ngày) khớp nhất trong lịch sử; null nếu không có quy luật rõ (< 60%). */
export function detectPowerPeriod(history: Handover[], maxP = 14): number | null {
  const m = new Map(history.map(r => [key(r.startdate.slice(0, 10), r.shift), r]));
  let best: { P: number; rate: number } | null = null;
  for (let P = 1; P <= maxP; P++) {
    let ok = 0, tot = 0;
    for (const r of history) {
      if (!norm(r.main_power)) continue;
      const p = m.get(key(addDays(r.startdate.slice(0, 10), -P), r.shift));
      if (!p || !norm(p.main_power)) continue;
      tot++;
      if (norm(p.main_power) === norm(r.main_power) && norm(p.sub_power) === norm(r.sub_power)) ok++;
    }
    if (tot < 6) continue;
    // Ưu tiên P nhỏ nhất: bội số của P (2P, 3P…) khớp ngang nhau, không được vượt rõ rệt
    if (!best || ok / tot > best.rate + 0.02) best = { P, rate: ok / tot };
  }
  return best && best.rate >= 0.6 ? best.P : null;
}

/** Cặp điều độ cho (date, shift): đa số phiếu của cùng ca cách ±k·P ngày (k = 1..3) — một ca
 *  ghi nhầm không kéo lệch gợi ý. Không có phiếu nào → null. */
export function suggestPower(history: Handover[], date: string, shift: string): { main: string; sub: string } | null {
  const P = detectPowerPeriod(history);
  if (!P) return null;
  const m = new Map(history.map(r => [key(r.startdate.slice(0, 10), r.shift), r]));
  const votes = new Map<string, { pair: { main: string; sub: string }; n: number; near: number }>();
  for (let k = 1; k <= 3; k++) {
    for (const dir of [-1, 1]) {
      const r = m.get(key(addDays(date, dir * k * P), shift));
      if (!r || !norm(r.main_power) || !norm(r.sub_power)) continue;
      const id = `${norm(r.main_power)}|${norm(r.sub_power)}`;
      const v = votes.get(id) ?? { pair: { main: r.main_power.trim(), sub: r.sub_power.trim() }, n: 0, near: k };
      v.n++;
      votes.set(id, v);
    }
  }
  // Nhiều phiếu nhất; hoà thì lấy cặp ở ca gần nhất
  const best = [...votes.values()].sort((a, b) => b.n - a.n || a.near - b.near)[0];
  return best ? best.pair : null;
}
