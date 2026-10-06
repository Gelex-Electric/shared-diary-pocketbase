/**
 * Lịch trực tháng — phân ca phía công ty (trực đội QLVH) và kiểm tra lịch.
 *
 * Module THUẦN (không import PocketBase) để chạy được bằng `tsx` trong `scripts/test_roster.ts`.
 *
 * MÔ HÌNH KÍP (theo file Excel "Nhat_ky_truc_van_hanh.xlsm" — user chốt 06/10/2026):
 *  - Xếp nhân sự theo `IDnum`: STT 1,3,5,… là TRỰC CHÍNH của kíp A,B,C,…; STT 2,4,6,… là TRỰC PHỤ.
 *    Số kíp K = ⌊số người / 2⌋ (8 người = 4 kíp, 6 người = 3 kíp).
 *  - Các kíp nối nhau theo TỪNG CA, liên tục qua ngày/tháng/năm: ca thứ g (đếm từ Ca 1 ngày
 *    01/01/2026) do kíp (g + pha) mod K trực → một kíp không bao giờ trực 2 ca liền nhau
 *    (8 giờ làm / 24 giờ nghỉ với 4 kíp).
 *  - XOAY THÁNG = ĐỔI CẶP: trực chính giữ kíp; trực phụ dịch 1 kíp mỗi tháng (kíp j tháng m
 *    lấy phụ thứ (j + m) mod K) → mỗi tháng đi cùng đồng nghiệp khác. Chiều dịch +1 bảo đảm
 *    người phụ mới của kíp trực Ca 1 mùng 1 không phải người vừa trực Ca 3 đêm cuối tháng.
 *  - Nối tiếp tháng trước: pha được chọn để kíp Ca 1 mùng 1 là kíp ngay sau kíp Ca 3 đêm cuối
 *    tháng trước (nhận ra kíp qua tên trực chính). Tháng trước nhập tay không khớp → thử các
 *    pha khác, lấy pha đầu tiên không trùng ca giáp tháng.
 */
import type { RosterSlot } from '../types';

export const SHIFTS = ['Ca 1', 'Ca 2', 'Ca 3'] as const;
export const DUTY_ROLES = ['main_duty', 'sub_duty'] as const;
export const POWER_ROLES = ['main_power', 'sub_power'] as const;
export const ROLES = [...DUTY_ROLES, ...POWER_ROLES] as const;
export type Role = typeof ROLES[number];

export const ROLE_LABEL: Record<Role, string> = {
  main_duty: 'Trực chính', sub_duty: 'Trực phụ',
  main_power: 'Điều độ chính', sub_power: 'Điều độ phụ',
};

/** Giờ chuẩn của từng ca (Ca 3 kết thúc 06:00 hôm sau). */
export const SHIFT_TIMES: Record<string, [string, string]> = {
  'Ca 1': ['06:00', '14:00'], 'Ca 2': ['14:00', '22:00'], 'Ca 3': ['22:00', '06:00'],
};

export const normName = (s?: string) => (s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

export const addDays = (date: string, k: number) => {
  const x = new Date(`${date}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + k);
  return x.toISOString().slice(0, 10);
};

/** Các ngày `YYYY-MM-DD` của tháng `YYYY-MM`. */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export const emptySlot = (date: string, shift: string): RosterSlot =>
  ({ date, shift, main_duty: '', sub_duty: '', main_power: '', sub_power: '' });

/** Ca liền sau: Ca 1 → Ca 2 → Ca 3 → Ca 1 hôm sau. */
export const nextShift = (date: string, shift: string): [string, string] =>
  shift === 'Ca 1' ? [date, 'Ca 2'] : shift === 'Ca 2' ? [date, 'Ca 3'] : [addDays(date, 1), 'Ca 1'];
export const prevShift = (date: string, shift: string): [string, string] =>
  shift === 'Ca 3' ? [date, 'Ca 2'] : shift === 'Ca 2' ? [date, 'Ca 1'] : [addDays(date, -1), 'Ca 3'];

export const MIN_DUTY_STAFF = 6;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Chia kíp theo `IDnum`: STT lẻ = trực chính (kíp A, B, …), STT chẵn = trực phụ. Lẻ người → người cuối không vào kíp. */
export function crewsOf<T extends { IDnum: number }>(staff: T[]) {
  const sorted = [...staff].sort((a, b) => a.IDnum - b.IDnum);
  const K = Math.floor(sorted.length / 2);
  return {
    K,
    mains: sorted.filter((_, i) => i % 2 === 0).slice(0, K),
    subs: sorted.filter((_, i) => i % 2 === 1).slice(0, K),
    unused: sorted.slice(2 * K),
  };
}
export const crewLetter = (j: number) => String.fromCharCode(65 + j);

/** Số thứ tự ca g (Ca 1 ngày 01/01/2026 = 0) và chỉ số tháng liên tục (2026-01 = 0). Tính theo UTC. */
const shiftIndex = (date: string, shift: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const day = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 864e5);
  return day * 3 + SHIFTS.indexOf(shift as typeof SHIFTS[number]);
};
const monthIndex = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return (y - 2026) * 12 + (m - 1);
};

/** Kíp trực (0-based) của (ngày, ca) với pha `phase`. */
export const crewFor = (K: number, date: string, shift: string, phase = 0) => mod(shiftIndex(date, shift) + phase, K);

/** Trực chính/phụ phía công ty cho (ngày, ca) theo mô hình kíp. */
export function dutyFor<T extends { IDnum: number; Name: string }>(staff: T[], date: string, shift: string, phase = 0) {
  const { K, mains, subs } = crewsOf(staff);
  if (K === 0) return { main_duty: '', sub_duty: '' };
  const j = crewFor(K, date, shift, phase);
  return { main_duty: mains[j].Name, sub_duty: subs[mod(j + monthIndex(date), K)].Name };
}

/**
 * Phân ca cả tháng phía công ty (mô hình kíp). Ít hơn `MIN_DUTY_STAFF` người → null.
 * `before` = các ca đã lưu ngay trước tháng: dùng để nối tiếp thứ tự kíp và kiểm tra giáp tháng.
 * Trả `continued` = true nếu nối tiếp được đúng kíp tháng trước.
 */
export function buildMonthDuty<T extends { IDnum: number; Name: string }>(
  staff: T[], month: string, before: RosterSlot[] = [],
): { slots: RosterSlot[]; phase: number; continued: boolean; unused: T[] } | null {
  if (staff.length < MIN_DUTY_STAFF) return null;
  const { K, mains, unused } = crewsOf(staff);
  const days = daysOfMonth(month);
  const build = (phase: number) => days.flatMap(date =>
    SHIFTS.map(shift => ({ ...emptySlot(date, shift), ...dutyFor(staff, date, shift, phase) })));
  const dutyClash = (slots: RosterSlot[]) => validateRoster(slots, before)
    .some(i => i.kind === 'consecutive' && (DUTY_ROLES as readonly string[]).includes(i.role));

  // Pha nối tiếp: kíp Ca 1 mùng 1 = kíp sau kíp Ca 3 đêm cuối tháng trước (nhận qua trực chính)
  const tail = before.find(s => s.date === addDays(days[0], -1) && s.shift === 'Ca 3');
  const j = tail ? mains.findIndex(s => normName(s.Name) === normName(tail.main_duty)) : -1;
  const contPhase = j >= 0 ? mod(j + 1 - shiftIndex(days[0], 'Ca 1'), K) : null;
  const candidates = [...new Set([...(contPhase !== null ? [contPhase] : []), ...Array.from({ length: K }, (_, p) => p)])];
  for (const phase of candidates) {
    const slots = build(phase);
    if (!dutyClash(slots)) return { slots, phase, continued: phase === contPhase, unused };
  }
  const phase = contPhase ?? 0;
  return { slots: build(phase), phase, continued: contPhase !== null, unused };
}

export type RosterIssueKind = 'consecutive' | 'same_in_shift' | 'empty';
export interface RosterIssue {
  date: string;
  shift: string;
  role: Role;
  kind: RosterIssueKind;
  message: string;
}

/**
 * Kiểm tra lịch: (1) không ai trực 2 ca liên tiếp — cả công ty lẫn điều độ, so mọi vị trí của
 * ca liền trước; (2) không trùng người trong cùng ca; (3) ô trống.
 * `before` = các ca ngay trước tháng (vd Ca 3 ngày cuối tháng trước) để bắt lỗi giáp tháng.
 */
export function validateRoster(slots: RosterSlot[], before: RosterSlot[] = []): RosterIssue[] {
  const byKey = new Map<string, RosterSlot>();
  for (const s of [...before, ...slots]) byKey.set(`${s.date}|${s.shift}`, s);
  const issues: RosterIssue[] = [];
  for (const s of slots) {
    for (const role of ROLES) {
      if (!normName(s[role])) issues.push({ date: s.date, shift: s.shift, role, kind: 'empty', message: `Chưa có ${ROLE_LABEL[role].toLowerCase()}` });
    }
    for (const [a, b] of [DUTY_ROLES, POWER_ROLES]) {
      if (normName(s[a]) && normName(s[a]) === normName(s[b]))
        issues.push({ date: s.date, shift: s.shift, role: b, kind: 'same_in_shift', message: `${s[b]} vừa trực chính vừa trực phụ` });
    }
    const [pd, ps] = prevShift(s.date, s.shift);
    const prev = byKey.get(`${pd}|${ps}`);
    if (!prev) continue;
    const prevNames = new Set(ROLES.map(r => normName(prev[r])).filter(Boolean));
    for (const role of ROLES) {
      if (normName(s[role]) && prevNames.has(normName(s[role])))
        issues.push({ date: s.date, shift: s.shift, role, kind: 'consecutive', message: `${s[role].trim()} vừa trực ${ps} ngày ${pd.slice(8)}/${pd.slice(5, 7)}` });
    }
  }
  return issues;
}
