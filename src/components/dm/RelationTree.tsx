/**
 * Tab 1 của "Quản lý chung" — CHỈ hiển thị, không nhập liệu.
 *
 * Vẽ sơ đồ cây biểu thị quan hệ giữa các bảng danh mục:
 *   dm_zone ──1:N──> dm_station ──1:N──> dm_point <──1:N── dm_customer
 *
 * Mỗi nút là một BẢNG (không phải một bản ghi) — kèm số bản ghi thật đọc từ
 * PocketBase để nhìn ra bảng nào đã có dữ liệu.
 */
import { useEffect, useState } from 'react';
import { Building2, Factory, Gauge, Users, CornerDownRight, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { loadCatalog, pbErrorMessage } from '../../lib/dm/repo';

interface TableNode {
  collection: string;
  title: string;
  icon: LucideIcon;
  /** Màu nhấn của nút (hex tĩnh — nhất quán ở cả light lẫn dark). */
  hex: string;
  /** Các field đáng chú ý, hiện dưới tên bảng. */
  fields: string[];
  /** Câu mô tả quan hệ với nút cha. */
  relation?: string;
}

const ZONE: TableNode = {
  collection: 'dm_zone', title: 'Khu công nghiệp', icon: Building2, hex: '#3b82f6',
  fields: ['code', 'name', 'address', 'active'],
};

const STATION: TableNode = {
  collection: 'dm_station', title: 'Trạm', icon: Factory, hex: '#10b981',
  fields: ['code', 'name', 'zone →', 'sdm_kva', 'p0_kw', 'pk_kw'],
  relation: 'Một KCN có nhiều trạm',
};

const POINT: TableNode = {
  collection: 'dm_point', title: 'Điểm đo', icon: Gauge, hex: '#f97316',
  fields: ['line_id', 'line_name', 'station →', 'customer →', 'role', 'connection', 'hsn', 'status'],
  relation: 'Một trạm có nhiều điểm đo',
};

const CUSTOMER: TableNode = {
  collection: 'dm_customer', title: 'Khách hàng', icon: Users, hex: '#8b5cf6',
  fields: ['mkh', 'name', 'address', 'zone →'],
  relation: 'Một khách hàng có nhiều điểm đo',
};

/** Thẻ một bảng. */
function TableCard({ node, count }: { node: TableNode; count: number | null }) {
  const Icon = node.icon;
  return (
    <div
      className="bg-surface rounded-xl border p-4 w-full max-w-[420px]"
      style={{ borderColor: node.hex, boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-content-center rounded-lg"
          style={{ backgroundColor: `${node.hex}1f`, color: node.hex }}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] font-bold text-ink leading-tight truncate">{node.title}</p>
          <p className="text-[11px] font-mono text-faint leading-tight">{node.collection}</p>
        </div>
        <span
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold"
          style={{ backgroundColor: `${node.hex}1f`, color: node.hex }}
          title="Số bản ghi hiện có"
        >
          {count === null ? '—' : `${count} bản ghi`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {node.fields.map(f => (
          <span
            key={f}
            className="rounded border border-[var(--border)] bg-subtle px-1.5 py-0.5 text-[10px] font-mono text-soft"
          >
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Đoạn nối dọc + nhãn quan hệ 1:N. */
function Connector({ label, hex }: { label: string; hex: string }) {
  return (
    <div className="flex items-stretch gap-3 pl-[18px]">
      <div className="w-px shrink-0" style={{ backgroundColor: 'var(--border)' }} />
      <div className="flex items-center gap-2 py-2">
        <CornerDownRight className="h-3.5 w-3.5 shrink-0" style={{ color: hex }} />
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-black tracking-wider"
          style={{ backgroundColor: `${hex}1f`, color: hex }}
        >
          1 : N
        </span>
        <span className="text-[12px] font-semibold text-soft">{label}</span>
      </div>
    </div>
  );
}

export default function RelationTree() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await loadCatalog();
      setCounts({
        dm_zone: d.zones.length,
        dm_station: d.stations.length,
        dm_customer: d.customers.length,
        dm_point: d.points.length,
      });
    } catch (e) {
      setError(pbErrorMessage(e));
      setCounts(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const countOf = (c: string) => (counts ? counts[c] ?? 0 : null);

  return (
    <div className="space-y-4">
      {/* Thanh tiêu đề + nạp lại */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-soft">
          Sơ đồ quan hệ giữa các bảng danh mục. Số bản ghi đọc trực tiếp từ PocketBase.
        </p>
        <button onClick={() => void load()} className="vl-btn vl-btn-secondary vl-btn-sm" disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Nạp lại</span>
        </button>
      </div>

      {error && (
        <div className="vl-alert vl-alert-light-danger">
          Không đọc được dữ liệu: {error}
        </div>
      )}

      <div className="vl-card">
        {/* Nhánh chính: KCN → Trạm → Điểm đo */}
        <TableCard node={ZONE} count={countOf(ZONE.collection)} />
        <Connector label={STATION.relation!} hex={STATION.hex} />

        <div className="pl-9">
          <TableCard node={STATION} count={countOf(STATION.collection)} />
          <Connector label={POINT.relation!} hex={POINT.hex} />

          <div className="pl-9">
            <TableCard node={POINT} count={countOf(POINT.collection)} />

            {/* Ràng buộc vật tư của điểm đo — chưa có bảng, nêu để thấy bước sau */}
            <div className="mt-3 max-w-[420px] rounded-xl border border-dashed border-[var(--border)] bg-subtle p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-faint">
                Ràng buộc vật tư của mỗi điểm đo
              </p>
              <ul className="mt-1.5 space-y-1 text-[12px] text-soft">
                <li>• Bắt buộc 1 công tơ và 1 đo xa GP-03</li>
                <li>• Đấu <b className="text-dim">gián tiếp</b>: đủ 3 TI, HSN suy từ tỷ số TI</li>
                <li>• Đấu <b className="text-dim">trực tiếp</b>: không cần TI, HSN = 1</li>
              </ul>
              <p className="mt-2 text-[11px] italic text-faint">
                Bảng vật tư (dm_asset) làm ở bước sau.
              </p>
            </div>
          </div>
        </div>

        {/* Nhánh phụ: Khách hàng → Điểm đo */}
        <div className="mt-7 border-t border-dashed border-[var(--border)] pt-5">
          <TableCard node={CUSTOMER} count={countOf(CUSTOMER.collection)} />
          <Connector label={`${CUSTOMER.relation!} (trỏ vào dm_point.customer)`} hex={CUSTOMER.hex} />
          <p className="pl-[52px] text-[12px] text-faint">
            Một trạm vì thế có thể chứa điểm đo của nhiều khách hàng khác nhau.
          </p>
        </div>
      </div>
    </div>
  );
}
