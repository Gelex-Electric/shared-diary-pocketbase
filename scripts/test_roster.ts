/**
 * Kiểm thử lịch trực tháng (lib thuần): `npx tsx scripts/test_roster.ts`
 *  - phân ca công ty (mô hình kíp như file Excel): không ai 2 ca liên tiếp (kể cả giáp tháng,
 *    giáp năm), kíp nối tiếp liên tục, mỗi tháng đổi cặp (trực phụ dịch 1 kíp);
 *  - phân ca điều độ: nối tiếp đúng chu kỳ, chịu được ca ghi nhầm và lịch sử đứt quãng;
 *  - validateRoster bắt được lỗi cố ý cài.
 */
import { buildMonthDuty, validateRoster, crewsOf, crewFor, addDays, SHIFTS } from '../src/lib/dutyRotation';
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
const dutyIssues = (slots: RosterSlot[], before: RosterSlot[]) =>
  validateRoster(slots.map(withPower), before.map(withPower)).filter(i => i.kind !== 'empty' && i.role.endsWith('duty'));

// 1. Công ty: 6/7/8/10 người, 2026-01 → 2027-12, mỗi tháng nối tiếp tháng trước
for (const N of [6, 7, 8, 10]) {
  const staff = staffOf(N);
  const { K, mains } = crewsOf(staff);
  let prev: RosterSlot[] = [];
  for (const m of months('2026-01', 24)) {
    const r = buildMonthDuty(staff, m, prev)!;
    const bad = dutyIssues(r.slots, prev);
    check(bad.length === 0, `N=${N} ${m}: ${bad.slice(0, 3).map(b => `${b.date} ${b.shift} ${b.message}`).join('; ')}`);
    if (prev.length) {
      check(r.continued, `N=${N} ${m}: không nối tiếp được kíp tháng trước`);
      // Kíp Ca 1 mùng 1 = kíp sau kíp Ca 3 đêm cuối tháng trước
      const jPrev = mains.findIndex(s => s.Name === prev[prev.length - 1].main_duty);
      const jNow = mains.findIndex(s => s.Name === r.slots[0].main_duty);
      check(jNow === (jPrev + 1) % K, `N=${N} ${m}: kíp đầu tháng ${jNow} ≠ ${(jPrev + 1) % K}`);
      // Xoay tháng = đổi cặp: mọi trực chính đi với trực phụ khác tháng trước
      const pairOf = (slots: RosterSlot[]) => new Map(slots.map(s => [s.main_duty, s.sub_duty]));
      const a = pairOf(prev), b = pairOf(r.slots);
      check([...b].every(([main, sub]) => a.get(main) !== sub), `N=${N} ${m}: có cặp không đổi so với tháng trước`);
    }
    // Trong tháng: cặp cố định (mỗi trực chính chỉ đi với 1 trực phụ)
    const subsOf = new Map<string, Set<string>>();
    for (const s of r.slots) (subsOf.get(s.main_duty) ?? subsOf.set(s.main_duty, new Set()).get(s.main_duty)!).add(s.sub_duty);
    check([...subsOf.values()].every(v => v.size === 1), `N=${N} ${m}: cặp thay đổi giữa tháng`);
    prev = r.slots;
  }
}

// 1b. Kíp xoay từng ca liên tục: 4 kíp → ngày mốc A-B-C, hôm sau D-A-B (giống file Excel)
{
  const seq = ['2026-01-01', '2026-01-02'].flatMap(d => SHIFTS.map(s => crewFor(4, d, s)));
  check(seq.join('') === '012301', `thứ tự kíp ${seq.join('')} ≠ 012301`);
}

// 2. Tháng trước nhập tay: Ca 3 đêm cuối tháng là người không thuộc kíp nào / trùng người Ca 1 → chọn pha khác
for (const N of [6, 8]) {
  const staff = staffOf(N);
  const nominal = buildMonthDuty(staff, '2026-11')!.slots;
  const tail: RosterSlot = { date: '2026-10-31', shift: 'Ca 3', main_duty: 'Người ngoài', sub_duty: nominal[0].sub_duty, main_power: '', sub_power: '' };
  const r = buildMonthDuty(staff, '2026-11', [tail])!;
  check(dutyIssues(r.slots, [tail]).length === 0, `N=${N}: không tránh được trùng giáp tháng khi tháng trước nhập tay`);
  check(!r.continued, `N=${N}: báo nối tiếp sai khi tháng trước nhập tay`);
}
check(buildMonthDuty(staffOf(5), '2026-11') === null, '< 6 người phải trả null');
check(buildMonthDuty(staffOf(7), '2026-11')!.unused.length === 1, '7 người: 1 người không vào kíp');

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

// 3c. Lịch sử điều độ có 1 ca ghi nhầm → bỏ phiếu không chép lặp lỗi đó mỗi chu kỳ
{
  const gen = cases[1][2];
  const hist = histOf(gen, '2026-08-02', 60);
  const wrongIdx = hist.findIndex(x => x.date === '2026-09-28' && x.shift === 'Ca 1');
  hist[wrongIdx] = { ...hist[wrongIdx], main_power: 'NHẦM', sub_power: 'NHẦM' };
  const { slots } = buildMonthPower(hist, '2026-10');
  check(!slots.some(s => s.main_power === 'NHẦM'), 'điều độ: ca ghi nhầm trong lịch sử bị chép sang tháng mới');
}
// 3d. Lịch sử dừng từ lâu (cách tháng > 1 tháng) vẫn nối được chu kỳ
{
  const gen = cases[0][2];
  const hist = histOf(gen, '2026-06-02', 60); // 02/06 → 31/07, tháng cần lập là 10
  const { slots, period } = buildMonthPower(hist, '2026-10');
  const truth = histOf(gen, '2026-06-02', 152).filter(x => x.date.startsWith('2026-10'));
  check(period === 4 && slots.every((s, i) => s.main_power === truth[i].main_power), 'điều độ: không nối được chu kỳ khi lịch sử cách xa');
}

// 4. validateRoster bắt lỗi cài sẵn
const base = buildMonthDuty(staffOf(6), '2026-10')!.slots.map(withPower);
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
