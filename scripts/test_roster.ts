/**
 * Kiểm thử lịch trực tháng (lib thuần): `npx tsx scripts/test_roster.ts`
 *  - phân ca công ty: không ai 2 ca liên tiếp (kể cả giáp tháng, giáp năm), có xoay mỗi tháng,
 *    khớp thuật toán cũ của HandoverManager (để lịch đã dùng không bị đảo);
 *  - phân ca điều độ: nối tiếp đúng chu kỳ;
 *  - validateRoster bắt được lỗi cố ý cài.
 */
import { buildMonthDuty, validateRoster, dutyFor, daysOfMonth, addDays, SHIFTS, rotatedDutyStaff } from '../src/lib/dutyRotation';
import { buildMonthPower, detectPowerPeriod } from '../src/lib/powerRotation';
import type { RosterSlot } from '../src/types';

let fail = 0, pass = 0;
const check = (cond: boolean, msg: string) => { if (cond) pass++; else { fail++; console.error('✗', msg); } };

const months = (from: string, n: number) => Array.from({ length: n }, (_, i) => {
  const [y, m] = from.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + i, 1));
  return d.toISOString().slice(0, 7);
});
const staffOf = (n: number) => Array.from({ length: n }, (_, i) => ({ IDnum: i + 1, Name: `NV${i + 1}` }));
const withPower = (s: RosterSlot) => ({ ...s, main_power: 'x', sub_power: 'y' }); // điều độ không xét ở phần này

// 1. Công ty: 6/7/8 người, 2026-01 → 2027-12
for (const N of [6, 7, 8]) {
  const staff = staffOf(N);
  let prev: RosterSlot[] = [];
  for (const m of months('2026-01', 24)) {
    const slots = buildMonthDuty(staff, m)!.map(withPower);
    const bad = validateRoster(slots, prev.slice(-1)).filter(i => i.kind !== 'empty' && !i.role.endsWith('power'));
    check(bad.length === 0, `N=${N} ${m}: ${bad.map(b => `${b.date} ${b.shift} ${b.message}`).join('; ')}`);
    // Xoay tháng: Ca 1 mùng 1 ≠ ca "tiếp nối y nguyên" (xoay +1 như ngày thường)
    if (prev.length) {
      const last = prev[prev.length - 1].date;
      const cont = rotatedDutyStaff(staff, last);
      const contNext = [...cont.slice(1), cont[0]];
      check(contNext[0].Name !== slots[0].main_duty, `N=${N} ${m}: đầu tháng không xoay`);
    }
    prev = slots;
  }
}

// 2. Khớp thuật toán cũ (HandoverManager trước khi tách) — chạy trong múi giờ VN
const oldAlgo = (staff: { IDnum: number; Name: string }[], dateStr: string, shift: string) => {
  const date = new Date(dateStr);
  const dayIndex = Math.floor((date.getTime() - new Date(2026, 0, 1).getTime()) / (1000 * 60 * 60 * 24));
  const rotated = [...staff].sort((a, b) => a.IDnum - b.IDnum);
  const rotation = Math.abs(dayIndex + date.getMonth()) % rotated.length;
  for (let i = 0; i < rotation; i++) rotated.push(rotated.shift()!);
  const k = { 'Ca 1': 0, 'Ca 2': 2, 'Ca 3': 4 }[shift]!;
  return { main_duty: rotated[k].Name, sub_duty: rotated[k + 1].Name };
};
if (process.env.TZ === 'Asia/Ho_Chi_Minh') {
  // bản cũ chỉ còn đúng tới hết 2026 (sau đó đã đổi sang chỉ số tháng liên tục)
  for (const N of [6, 8]) for (const m of months('2025-12', 13)) for (const d of daysOfMonth(m)) for (const s of SHIFTS) {
    const a = dutyFor(staffOf(N), d, s), b = oldAlgo(staffOf(N), d, s);
    check(a.main_duty === b.main_duty && a.sub_duty === b.sub_duty, `N=${N} ${d} ${s}: lệch thuật toán cũ`);
  }
} else console.warn('! Bỏ qua so thuật toán cũ — chạy lại với TZ=Asia/Ho_Chi_Minh');

// 3. Điều độ: 4 cặp xoay nối tiếp từng ca (P=4), 5 cặp (P=5), Phong Điền 2 ngày/ca (P=10)
const pairs = (n: number) => Array.from({ length: n }, (_, i) => [`ĐĐ${i}a`, `ĐĐ${i}b`]);
const histOf = (gen: (dayIdx: number, shiftIdx: number) => string[], from: string, days: number) =>
  Array.from({ length: days }, (_, d) => SHIFTS.map((shift, s) => {
    const [a, b] = gen(d, s);
    return { date: addDays(from, d), shift, main_power: a, sub_power: b };
  })).flat();
const cases: [string, number, (d: number, s: number) => string[]][] = [
  ['4 cặp nối tiếp', 4, (d, s) => pairs(4)[(d * 3 + s) % 4]],
  ['5 cặp nối tiếp', 5, (d, s) => pairs(5)[(d * 3 + s) % 5]],
  ['5 cặp × 2 ngày', 10, (d, s) => pairs(5)[(Math.floor(d / 2) + [0, 3, 2][s] + (s === 1 ? d % 2 : 0)) % 5]],
];
for (const [name, P, gen] of cases) {
  const hist = histOf(gen, '2026-08-02', 60); // 02/08 → 30/09
  check(detectPowerPeriod(hist) === P, `${name}: dò chu kỳ ${detectPowerPeriod(hist)} ≠ ${P}`);
  const { slots } = buildMonthPower(hist, '2026-10');
  const truth = histOf(gen, '2026-08-02', 91).filter(x => x.date.startsWith('2026-10'));
  const wrong = slots.filter((s, i) => s.main_power !== truth[i].main_power || s.sub_power !== truth[i].sub_power);
  check(wrong.length === 0, `${name}: ${wrong.length} ca điều độ không nối tiếp đúng`);
}
check(buildMonthPower([], '2026-10').period === null, 'không lịch sử → period null');

// 4. validateRoster bắt lỗi cài sẵn
const base = buildMonthDuty(staffOf(6), '2026-10')!.map(withPower);
const bad = base.map(s => ({ ...s }));
bad[1].main_duty = bad[0].sub_duty;              // 01/10 Ca 2 trùng Ca 1 → liên tiếp
bad[3].sub_duty = bad[3].main_duty;              // 02/10 Ca 1 trùng trong ca
bad[4].main_power = '';                          // ô trống
const kinds = validateRoster(bad).map(i => `${i.date}|${i.shift}|${i.kind}`);
check(kinds.includes('2026-10-01|Ca 2|consecutive'), 'không bắt được 2 ca liên tiếp');
check(kinds.includes('2026-10-02|Ca 1|same_in_shift'), 'không bắt được trùng trong ca');
check(kinds.includes('2026-10-02|Ca 2|empty'), 'không bắt được ô trống');
const tail: RosterSlot = { ...base[base.length - 1], date: '2026-09-30', main_duty: base[0].main_duty };
check(validateRoster(base, [tail]).some(i => i.date === '2026-10-01' && i.kind === 'consecutive'), 'không bắt lỗi giáp tháng');

console.log(`${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
