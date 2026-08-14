/**
 * Biểu tượng phân biệt điểm đo — dùng chung cho bảng Điểm đo và cây Đơn vị.
 *
 * Điểm đo chính đeo biểu tượng đồng hồ đo; điểm đo phụ đeo biểu tượng theo
 * đuôi mã của nó (`sub_label`): nhãn mục đích có biểu tượng riêng, còn đuôi là
 * tên tắt khách hàng thì dùng biểu tượng khách hàng.
 *
 * Tách khỏi `lib/dm/naming.ts` để module quy tắc đặt tên vẫn thuần, không kéo
 * theo React/lucide.
 */
import {
  Gauge, Lightbulb, Flame, Droplets, Waves, Building2, Factory,
  BatteryCharging, Users, Tag,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { purposeLabelOf } from '../../lib/dm/naming';
import type { Point } from '../../lib/dm/types';

interface PointBadge {
  icon: LucideIcon;
  /** Màu hex tĩnh để giống nhau ở cả light lẫn dark. */
  hex: string;
  /** Chữ hiện cạnh biểu tượng (mã ngắn). */
  code: string;
  /** Chú thích đầy đủ khi rê chuột. */
  title: string;
}

const PURPOSE_ICON: Record<string, { icon: LucideIcon; hex: string }> = {
  CSCC:       { icon: Lightbulb,       hex: '#f59e0b' },
  PCCC:       { icon: Flame,           hex: '#ef4444' },
  BCC:        { icon: Droplets,        hex: '#06b6d4' },
  'TRAM-BOM': { icon: Waves,           hex: '#0ea5e9' },
  VP:         { icon: Building2,       hex: '#6366f1' },
  NX:         { icon: Factory,         hex: '#10b981' },
  DP:         { icon: BatteryCharging, hex: '#8b5cf6' },
};

export function pointBadge(p: Point): PointBadge {
  if (p.role !== 'phu') {
    return { icon: Gauge, hex: '#3b82f6', code: 'Chính', title: 'Điểm đo chính' };
  }
  const label = p.sub_label ?? '';
  const known = PURPOSE_ICON[label];
  if (known) {
    return { ...known, code: label, title: `Điểm đo phụ — ${purposeLabelOf(label)}` };
  }
  // Đuôi không nằm trong danh sách mục đích: hoặc là tên tắt KH phụ (khác
  // khách hàng với điểm chính), hoặc là chuỗi người dùng tự nhập.
  return label
    ? { icon: Users, hex: '#8b5cf6', code: label, title: `Điểm đo phụ — ${label}` }
    : { icon: Tag, hex: '#64748b', code: 'Phụ', title: 'Điểm đo phụ' };
}

/** Chip biểu tượng + mã, dùng trong bảng. */
export function PointBadgeChip({ point }: { point: Point }) {
  const b = pointBadge(point);
  const Icon = b.icon;
  return (
    <span
      title={b.title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold"
      style={{ backgroundColor: `${b.hex}1f`, color: b.hex }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{b.code}</span>
    </span>
  );
}

/** Chỉ biểu tượng, không nền — dùng trong cây cho đỡ rối. */
export function PointBadgeIcon({ point }: { point: Point }) {
  const b = pointBadge(point);
  const Icon = b.icon;
  return (
    <span title={b.title} className="inline-flex shrink-0">
      <Icon className="h-4 w-4" style={{ color: b.hex }} />
    </span>
  );
}
