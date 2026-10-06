/**
 * Lịch trực tháng — phân ca phía công ty (trực đội QLVH) và kiểm tra lịch.
 *
 * Module THUẦN (không import PocketBase) để chạy được bằng `tsx` trong `scripts/test_roster.ts`.
 *
 * Vòng xoay giữ nguyên thuật toán cũ của `HandoverManager.handleAutoAssign` (đã dùng từ đầu
 * năm 2026, nhân viên đã quen): xếp nhân sự theo `IDnum`, mỗi ngày xoay thêm 1 vị trí;
 * Ca 1 = vị trí 0,1 · Ca 2 = 2,3 · Ca 3 = 4,5 (chính, phụ).
 * Xoay tháng: cộng thêm `tháng` (0..11) → đầu tháng vòng xoay nhảy 2 vị trí thay vì 1.
 * Hệ số tháng PHẢI là 1: hệ số 2 (bản cũ) làm nhảy 3 → người Ca 3 đêm cuối tháng trực luôn
 * Ca 1 sáng mùng 1 (sự cố 06/10/2026).
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

/** Thứ tự nhân sự trực đội của một ngày (đã xoay). Tính hoàn toàn theo UTC — không phụ thuộc múi giờ máy. */
export function rotatedDutyStaff<T extends { IDnum: number }>(staff: T[], date: string): T[] {
  const sorted = [...staff].sort((a, b) => a.IDnum - b.IDnum);
  const [y, m, d] = date.split('-').map(Number);
  const dayIndex = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 864e5);
  // Chỉ số tháng LIÊN TỤC qua các năm (2026-01 = 0, 2027-01 = 12…). Dùng tháng trong năm (0..11)
  // thì đầu năm bước nhảy = 1 − 11 = −10 → với 7 người trùng ca 31/12 → 01/01. Năm 2026 kết quả
  // y hệt bản cũ; trước 2026 giữ tháng trong năm cho khớp dữ liệu đã có.
  const monthIndex = y >= 2026 ? (y - 2026) * 12 + (m - 1) : m - 1;
  const rot = Math.abs(dayIndex + monthIndex) % sorted.length;
  return [...sorted.slice(rot), ...sorted.slice(0, rot)];
}

/** Trực chính/phụ phía công ty cho (ngày, ca). */
export function dutyFor<T extends { IDnum: number; Name: string }>(staff: T[], date: string, shift: string) {
  const r = rotatedDutyStaff(staff, date);
  const k = SHIFTS.indexOf(shift as typeof SHIFTS[number]) * 2;
  return { main_duty: r[k]?.Name ?? '', sub_duty: r[k + 1]?.Name ?? '' };
}

/** Phân ca cả tháng phía công ty. Ít hơn `MIN_DUTY_STAFF` người → null. */
export function buildMonthDuty<T extends { IDnum: number; Name: string }>(staff: T[], month: string): RosterSlot[] | null {
  if (staff.length < MIN_DUTY_STAFF) return null;
  return daysOfMonth(month).flatMap(date => SHIFTS.map(shift => ({ ...emptySlot(date, shift), ...dutyFor(staff, date, shift) })));
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
