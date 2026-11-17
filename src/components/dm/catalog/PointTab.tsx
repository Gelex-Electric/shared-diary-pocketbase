/**
 * Tab Điểm đo của màn Danh mục: bảng.
 * Tách khỏi `CatalogEntry.tsx` ngày 17/11/2026 (plan `2026-11-17-tach-catalog-entry.md`,
 * đợt 5) — JSX NGUYÊN VĂN; state + logic ở `useCatalog.ts`, truyền vào bằng `{...cat}`.
 */
import {
  CornerDownRight, ArrowLeftRight,
} from 'lucide-react';
import { points } from '../../../lib/dm/repo';
import {
  TH_CLS,
} from '../entryUi';
import { PointBadgeChip, PointBadgeIcon, StatusTag } from '../pointIcons';
import { ZoneTables } from '../ZoneTables';
import { RowActions } from './RowActions';
import type { CatalogState } from './useCatalog';

export function PointTable(props: CatalogState) {
  const {
    d, loading, pointGroupsShown, emptyText, placeOf, customerMkh, editPoint, setTransferring, del,
    childrenOf,
  } = props;
  return (
    <>
        <>
          {!d?.stations.length && !loading && (
            <div className="vl-alert vl-alert-light-warning">
              Phải khai ít nhất một trạm ở tab "Trạm" trước khi thêm điểm đo.
            </div>
          )}
          <ZoneTables groups={pointGroupsShown} unit="điểm đo" loading={loading}
            empty={emptyText('điểm đo', 'Chưa có điểm đo nào được khai.')}
            rowKey={r => r.point.id}
            columns={<>
              <th className={`${TH_CLS} w-[28%] pl-10`}>Mã điểm đo</th>
              <th className={`${TH_CLS} w-[22%]`}>Trạm</th>
              <th className={`${TH_CLS} w-[13%]`}>Khách hàng</th>
              <th className={`${TH_CLS} w-[10%]`}>Loại</th>
              <th className={`${TH_CLS} w-[13%]`}>Trạng thái</th>
              <th className={`${TH_CLS} w-[6%]`}>HSN</th>
              <th className={`${TH_CLS} w-[8%] pr-10 text-right`}>Thao tác</th>
            </>}
            renderRow={({ point: p, isChild }) => (
              <tr className="transition-colors hover:bg-subtle/50">
                <td className={`px-6 py-4 ${isChild ? 'pl-16' : 'pl-10'}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    {isChild && <CornerDownRight className="h-4 w-4 shrink-0 text-faint" />}
                    <PointBadgeIcon point={p} />
                    <span className={`truncate font-mono text-sm ${isChild ? 'text-dim' : 'font-bold text-ink'}`}
                      title={p.code || p.line_name || ''}>
                      {p.code || p.line_name || '—'}
                    </span>
                  </span>
                </td>
                <td className="truncate px-6 py-4 font-mono text-xs text-soft" title={placeOf(p)}>{placeOf(p)}</td>
                <td className="px-6 py-4 font-mono text-xs font-bold text-soft">{customerMkh(p.customer)}</td>
                <td className="px-6 py-4"><PointBadgeChip point={p} /></td>
                <td className="px-6 py-4"><StatusTag status={p.status} /></td>
                <td className="px-6 py-4 text-sm font-bold text-dim">{p.hsn ?? '—'}</td>
                <td className="px-6 py-4 pr-10 text-right">
                  <RowActions onEdit={() => editPoint(p)}
                    extra={{
                      icon: ArrowLeftRight,
                      title: 'Chuyển chủ thể (giữ nguyên mã điểm đo)',
                      onClick: () => setTransferring(p),
                    }}
                    onDelete={() => void del(`điểm đo ${p.code || p.line_name}`, () => points.remove(p.id),
                      childrenOf(p.id) > 0
                        ? `Điểm đo này đang có ${childrenOf(p.id)} điểm đo phụ. Xóa nó KHÔNG xóa các điểm phụ — chúng sẽ mất điểm đo chính.`
                        : undefined)} />
                </td>
              </tr>
            )} />
        </>
    </>
  );
}
