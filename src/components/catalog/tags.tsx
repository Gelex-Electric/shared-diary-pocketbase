import type { ReactNode } from 'react';
import { KCN_COLOR } from '../../lib/kcnColors';
import { type Asset, type CatalogData, type Point, ASSET_TYPE_LABEL, needsCalibration } from '../../lib/catalog';

/**
 * Tag màu cho bảng danh mục.
 *
 * Dùng class Tailwind TĨNH (không ghép chuỗi động) vì Tailwind quét mã nguồn
 * để sinh CSS — `bg-${color}-50` sẽ không được sinh ra và tag mất màu.
 * Màu KCN lấy từ lib/kcnColors.ts để trùng với các màn hình khác.
 */

const BASE = 'inline-flex items-center gap-1 text-[0.7rem] font-bold px-1.5 py-0.5 rounded whitespace-nowrap border';

export function Tag({ className = '', children, title }: {
  className?: string; children: ReactNode; title?: string;
}) {
  return <span className={`${BASE} ${className}`} title={title}>{children}</span>;
}

const GRAY = 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/40';

/* ---------------- Khu công nghiệp ---------------- */

export function ZoneTag({ zoneId, data }: { zoneId: string; data: CatalogData }) {
  const z = data.zones.find(x => x.id === zoneId);
  if (!z) return <span className="text-faint">—</span>;
  const c = KCN_COLOR[z.name];
  if (!c) return <Tag className={GRAY}>{z.code}</Tag>;
  return (
    <Tag className={`${c.bg} ${c.text} ${c.border}`} title={z.name}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{z.code}
    </Tag>
  );
}

/* ---------------- Điểm đo ---------------- */

export function RoleTag({ role }: { role: string }) {
  if (role === 'chinh') {
    return <Tag className="bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/40">CHÍNH</Tag>;
  }
  if (role === 'phu') {
    return <Tag className={GRAY}>phụ</Tag>;
  }
  return <span className="text-faint">—</span>;
}

const POINT_STATUS_TAG: Record<string, { cls: string; label: string }> = {
  du_kien: { label: 'Dự kiến', cls: 'bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/40' },
  chua_van_hanh: { label: 'Chưa vận hành', cls: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/40' },
  active: { label: 'Vận hành', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/40' },
  dismounted: { label: 'ĐÃ THÁO', cls: 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/40' },
};

export function PointStatusTag({ status }: { status: string }) {
  const t = POINT_STATUS_TAG[status];
  if (!t) return <span className="text-faint">—</span>;
  return <Tag className={t.cls}>{t.label}</Tag>;
}

/* ---------------- Vật tư ---------------- */

const ASSET_TYPE_CLS: Record<string, string> = {
  ME41: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/40',
  ME42: 'bg-cyan-50 text-cyan-700 border-cyan-300 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-500/40',
  DTS27: 'bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/40',
  TI: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/40',
  TU: 'bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/40',
  SIM: 'bg-lime-50 text-lime-700 border-lime-300 dark:bg-lime-500/10 dark:text-lime-300 dark:border-lime-500/40',
  GP03: 'bg-teal-50 text-teal-700 border-teal-300 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/40',
  KHAC: GRAY,
};

export function AssetTypeTag({ asset }: { asset: { type: string } }) {
  return <Tag className={ASSET_TYPE_CLS[asset.type] ?? GRAY}>{ASSET_TYPE_LABEL[asset.type] ?? asset.type}</Tag>;
}
const ASSET_STATUS_TAG: Record<string, { cls: string; label: string }> = {
  kho: { label: 'Trong kho', cls: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/40' },
  dang_treo: { label: 'Đang treo', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/40' },
  cho_kiem_dinh: { label: 'Chờ kiểm định', cls: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/40' },
  dang_kiem_dinh: { label: 'Đang kiểm định', cls: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/40' },
  dat: { label: 'KĐ đạt', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/40' },
  khong_dat: { label: 'KĐ không đạt', cls: 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/40' },
  thanh_ly: { label: 'Đã thanh lý', cls: 'bg-zinc-200 text-zinc-600 border-zinc-400 dark:bg-zinc-500/20 dark:text-zinc-400 dark:border-zinc-500/40' },
};

export function AssetStatusTag({ status }: { status: string }) {
  const t = ASSET_STATUS_TAG[status];
  if (!t) return <span className="text-faint">—</span>;
  return <Tag className={t.cls}>{t.label}</Tag>;
}

/** Vị trí hiện tại: điểm đo nào, hoặc kho nào. */
export function LocationTag({ asset, data }: { asset: Asset; data: CatalogData }) {
  const inst = data.installs.find(i => i.asset === asset.id && i.is_current);
  const pt: Point | undefined = inst ? data.points.find(p => p.id === inst.point) : undefined;
  if (pt) {
    return (
      <Tag className="bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/40"
        title={pt.line_name}>
        <span className="max-w-[9rem] truncate">{pt.line_name}</span>
      </Tag>
    );
  }
  const wh = data.warehouses.find(w => w.id === asset.current_warehouse);
  if (wh) return <Tag className={GRAY} title={wh.name}>kho {wh.code}</Tag>;
  return <Tag className="bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/40">chưa rõ</Tag>;
}

/** Quá hạn kiểm định — GP-03 không kiểm định nên không bao giờ quá hạn. */
export function OverdueTag({ asset }: { asset: Asset }) {
  if (!needsCalibration(asset.type) || !asset.next_calibration) return null;
  if (asset.next_calibration.slice(0, 10) >= new Date().toISOString().slice(0, 10)) return null;
  return (
    <Tag className="bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/40"
      title={`Hạn kiểm định ${asset.next_calibration.slice(0, 10)}`}>
      quá hạn KĐ
    </Tag>
  );
}
