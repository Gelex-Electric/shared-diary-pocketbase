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
  Gauge, Lightbulb, Flame, Droplets, Building2, Factory,
  BatteryCharging, Users, Tag, GlassWater, GitBranch,
  CircleCheck, CircleAlert, CircleDashed, CircleSlash, CircleHelp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { purposeLabelOf } from '../../lib/dm/naming';
import { STATUS_LABEL } from '../../lib/dm/types';
import type { Point, PointStatus } from '../../lib/dm/types';

interface PointBadge {
  icon: LucideIcon;
  /** Màu hex tĩnh để giống nhau ở cả light lẫn dark. */
  hex: string;
  /** Chữ hiện cạnh biểu tượng (mã ngắn). */
  code: string;
  /** Chú thích đầy đủ khi rê chuột. */
  title: string;
}

/**
 * Mỗi nhãn mục đích một biểu tượng riêng. Phải phủ ĐỦ `SUB_PURPOSES` bên
 * `lib/dm/naming.ts` — thiếu cái nào thì điểm đo đó rơi về biểu tượng khách
 * hàng chung chung, nhìn không ra mục đích nữa.
 */
const PURPOSE_ICON: Record<string, { icon: LucideIcon; hex: string }> = {
  CSCC:       { icon: Lightbulb,       hex: '#f59e0b' },
  CCNS:       { icon: GlassWater,      hex: '#0284c7' },
  PCCC:       { icon: Flame,           hex: '#ef4444' },
  // "Trạm bơm" bỏ ngày 27/08/2026: cùng một thứ với bơm chuyển cốt, mà BCC
  // mới là mã đang dùng thật (`TH.BQL.T1.180kVA.BCC`).
  BCC:        { icon: Droplets,        hex: '#06b6d4' },
  VP:         { icon: Building2,       hex: '#6366f1' },
  NX:         { icon: Factory,         hex: '#10b981' },
  DP:         { icon: BatteryCharging, hex: '#8b5cf6' },
  PHU:        { icon: GitBranch,       hex: '#64748b' },
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

/**
 * Chip biểu tượng + mã, dùng trong bảng.
 * Cùng khuôn với tag KCN ở bảng Trạm: viên thuốc bo tròn, `px-3 py-1`,
 * chữ in hoa giãn nhẹ — để các tag trong app nhìn đồng bộ, không bó sát chữ.
 */
export function PointBadgeChip({ point }: { point: Point }) {
  const b = pointBadge(point);
  const Icon = b.icon;
  return (
    <span
      title={b.title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
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

/**
 * Tag trạng thái vận hành của điểm đo.
 *
 * Trạng thái do hệ thống suy từ vật tư + hóa đơn (`lib/dm/pointStatus.ts`),
 * người dùng không chọn tay — nên ở đây chỉ có việc hiển thị.
 */
const STATUS_STYLE: Record<Exclude<PointStatus, ''>, string> = {
  du_kien:       'bg-subtle text-faint',
  chua_van_hanh: 'bg-[var(--warning-soft)] text-warn',
  active:        'bg-[var(--success-soft)] text-good',
  thao_go:       'bg-[var(--danger-soft)] text-bad',
};

export function StatusTag({ status }: { status?: PointStatus }) {
  if (!status) return <span className="text-[11px] italic text-faint">chưa tính</span>;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Trạng thái dạng CHỈ BIỂU TƯỢNG — dùng trong sơ đồ cây.
 *
 * Cây là chỗ để duyệt và chọn, không phải chỗ đọc số liệu: bấm vào là card chi
 * tiết bên cạnh nói đủ mọi thứ (user chốt 25/08/2026). Vì vậy mỗi hàng chỉ giữ
 * hai biểu tượng — loại điểm đo và trạng thái — thay cho một dãy tag chữ.
 */
const STATUS_ICON: Record<Exclude<PointStatus, ''>, { icon: LucideIcon; hex: string }> = {
  du_kien:       { icon: CircleDashed, hex: '#94a3b8' },
  chua_van_hanh: { icon: CircleAlert,  hex: '#f59e0b' },
  active:        { icon: CircleCheck,  hex: '#10b981' },
  thao_go:       { icon: CircleSlash,  hex: '#ef4444' },
};

export function StatusIcon({ status }: { status?: PointStatus }) {
  if (!status) {
    return (
      <span title="Chưa tính trạng thái" className="inline-flex shrink-0">
        <CircleHelp className="h-4 w-4 text-faint" />
      </span>
    );
  }
  const { icon: Icon, hex } = STATUS_ICON[status];
  return (
    <span title={STATUS_LABEL[status]} className="inline-flex shrink-0">
      <Icon className="h-4 w-4" style={{ color: hex }} />
    </span>
  );
}

/**
 * Tag thông tin trung tính (HSN, mã khách hàng…) — CÙNG hình khối với
 * `StatusTag` và `PointBadgeChip`: viên thuốc bo tròn, `px-3 py-1`, chữ 11px in
 * hoa giãn nhẹ.
 *
 * Có mặt vì rà lại 25/08/2026: cùng một hàng đang trộn ba kiểu tag khác nhau —
 * badge màu bó sát chữ, viên thuốc, và chữ trần không viền — nhìn như ba thứ
 * không liên quan. Mọi tag đứng cạnh nhau phải chung một khuôn.
 */
export function InfoTag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title}
      className="inline-flex shrink-0 items-center rounded-full bg-subtle px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-soft">
      {children}
    </span>
  );
}
