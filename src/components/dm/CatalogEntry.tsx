/**
 * Màn "Danh mục" (khối Văn phòng) — 4 bảng:
 *   Tab 1 Khu công nghiệp (dm_zone)
 *   Tab 2 Trạm            (dm_station)
 *   Tab 3 Khách hàng      (dm_customer)
 *   Tab 4 Điểm đo         (dm_point)
 *
 * Mã trạm và mã điểm đo do hệ thống sinh (xem `lib/dm/naming.ts`), không gõ tay.
 * Điểm đo phụ phải trỏ về một điểm đo chính cùng trạm và được thụt lề dưới nó.
 *
 * Khuôn giao diện bám mẫu `ElectricShiftManager`: tiêu đề + nút "Thêm …" ở đầu,
 * bảng full-width bên dưới, form nhập nằm trong MODAL nổi (không đặt cố định
 * đầu trang). Thêm và Sửa dùng chung một modal.
 */
import {
  Building2,
  Plus, RefreshCw, FileText, Search,
  CaseLower,
} from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import { Select } from '../ui/Select';
/* Luật chọn P0/Pk nằm ở `scripts/lib/lossParams.mjs` để pipeline (Node thuần,
   Actions không `npm ci` nên không có tsx) và app dùng CHUNG một bản. */
import type { Scope } from '../../lib/scope';
import {
  FormModal, TableCard, TH_CLS,
} from './entryUi';
import { ISSUE_LABEL, autoFillable } from '../../lib/dm/lowName';
import PointForm from './catalog/PointForm';
import AssetLifecycle from './AssetLifecycle';
import StockEntry from './StockEntry';
import SupplyAllocate from './SupplyAllocate';
import { TransferOwner } from './TransferOwner';
import LineAssign from './LineAssign';

export type { CatTab } from './catalog/constants';
import { SEARCH_HINT, type CatTab } from './catalog/constants';
import { useCatalog } from './catalog/useCatalog';
import { ZoneTable, ZoneForm } from './catalog/ZoneTab';
import { LineTable, LineForm } from './catalog/LineTab';
import { StationTable, StationForm } from './catalog/StationTab';
import { CustomerTable, CustomerForm } from './catalog/CustomerTab';
import { PointTable } from './catalog/PointTab';

export default function CatalogEntry({ scope: _scope = 'vanphong', tabs, initialTab }: {
  scope?: Scope;
  /**
   * Chỉ hiện các tab này (mặc định: tất cả). Tab Khách hàng nằm ở Hồ sơ kinh doanh
   * (user chốt 01/10/2026) nên màn Danh mục truyền danh sách KHÔNG có `customer`,
   * còn mục Khách hàng truyền `['customer']`. Một tab thì ẩn thanh tab.
   */
  tabs?: CatTab[];
  /** Tab mở đầu (vd Việc cần làm → Gắn vật tư dự kiến); mặc định tab đầu tiên. */
  initialTab?: CatTab;
}) {
  /* State + logic: `catalog/useCatalog.ts`; mỗi tab một file trong `catalog/`. */
  const cat = useCatalog({ scope: _scope, tabs, initialTab });
  const {
    dialog, tab, head, search, setSearch, filterZone, setFilterZone, zoneFilterOpts, load, loading,
    auditLowName, d, syncCustomers, syncing, openAdd, shownTabs, setTab, transferring,
    setTransferring, assigning, setAssigning, modal, modalTitle, closeModal, submit, saving, pf,
    editingId, customerOpts, stationOpts, pointCodeOf, lowNameOpen, lowNameRows, setLowNameOpen,
    fixAllLowName, fixingLowName,
  } = cat;

  return (
    <div className="relative space-y-6">
      {dialog}

      {/* ---------- Đầu trang: tiêu đề + hành động ---------- */}
      {/* Tab Vòng đời tự mang tiêu đề và nút Nạp lại riêng, và không có gì để
          "Thêm" — nên ẩn hẳn thanh này thay vì hiện một thanh nửa vời. */}
      {tab !== 'lifecycle' && tab !== 'stock' && tab !== 'supply' && (
      <div className="mb-2 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">{head.title}</h2>
          <p className="mt-1 text-sm text-soft">{head.desc}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          {/* Ô tìm kiếm — khuôn lấy nguyên từ màn "Công nợ khách hàng". */}
          <div className="relative w-full md:w-auto">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={SEARCH_HINT[tab]}
              className="w-full rounded-lg border border-[var(--border)] bg-surface py-2 pl-10 pr-4
                text-sm text-dim focus:outline-none focus:ring-1 focus:ring-accent sm:w-[260px]" />
          </div>
          {tab !== 'zone' && (
            <div className="w-full min-w-56 md:w-64">
              <Select value={filterZone} onChange={setFilterZone}
                options={zoneFilterOpts} placeholder="Tất cả KCN" icon={Building2} searchable />
            </div>
          )}
          <button onClick={() => void load()} disabled={loading} className="vl-btn vl-btn-secondary flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Nạp lại
          </button>
          {tab === 'customer' && (
            <button onClick={auditLowName} disabled={loading || !d}
              title="Đối chiếu tên viết thường với tên gốc — đúng và đủ chữ chưa"
              className="vl-btn vl-btn-secondary flex items-center gap-2">
              <CaseLower className="h-4 w-4" />
              Soát tên viết thường
            </button>
          )}
          {tab === 'customer' && (
            <button onClick={() => void syncCustomers()} disabled={syncing || loading}
              title="Lấy tên và địa chỉ theo hóa đơn có ngày chốt mới nhất"
              className="vl-btn vl-btn-secondary flex items-center gap-2">
              <FileText className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
              {syncing ? 'Đang đồng bộ…' : 'Đồng bộ từ hóa đơn'}
            </button>
          )}
          <button onClick={openAdd} className="flex flex-1 items-center justify-center gap-2 vl-btn vl-btn-primary md:flex-none">
            <Plus className="h-5 w-5" />
            {head.add}
          </button>
        </div>
      </div>
      )}

      {shownTabs.length > 1 && (
        <Tabs tabs={shownTabs} value={tab} onChange={t => {
          // Rời tab Kho vật tư ⇒ NẠP LẠI danh mục: `StockEntry` nạp/ghi dữ liệu
          // riêng, nên thiết bị vừa khai ở Kho không có trong `d.devices` của
          // màn này — ô chọn Số No ở form điểm đo không thấy (sự cố SIM
          // 8984048000962310906, 12/10/2026).
          if (tab === 'stock' && t !== 'stock') void load();
          setTab(t); setSearch('');
        }} />
      )}

      {/* ======================= Vòng đời vật tư ======================= */}
      {tab === 'lifecycle' && <AssetLifecycle scope={_scope} />}

      {/* ======================== Kho vật tư ======================== */}
      {tab === 'stock' && <StockEntry />}

      {/* ============== Gắn vật tư dự kiến (Nhóm Vật Tư, 02/11/2026) ============== */}
      {tab === 'supply' && <SupplyAllocate />}


      {/* ============================ KCN ============================ */}
      {tab === 'zone' && <ZoneTable {...cat} />}

      {/* ======================= Lộ đường dây ======================= */}
      {tab === 'line' && <LineTable {...cat} />}

      {/* ============================ Trạm ============================ */}
      {tab === 'station' && <StationTable {...cat} />}

      {/* ========================= Khách hàng ========================= */}
      {tab === 'customer' && <CustomerTable {...cat} />}

      {/* ============================ Điểm đo ============================ */}
      {tab === 'point' && <PointTable {...cat} />}

      {/* Chuyển chủ thể — hộp riêng, KHÔNG đụng vào mã điểm đo. */}
      <TransferOwner point={transferring} d={d}
        onClose={() => setTransferring(null)} onDone={() => void load()} />

      {/* Gắn hàng loạt trạm vào một lộ — mở từ nút "Gắn trạm" ở bảng Lộ. */}
      <LineAssign line={assigning} d={d}
        onClose={() => setAssigning(null)} onDone={() => void load()} />

      {/* ============================ Modal ============================ */}
      <FormModal open={modal !== null} title={modalTitle} onClose={closeModal} onSubmit={submit}
        saving={saving} wide>
        {modal === 'zone' && <ZoneForm {...cat} />}

        {modal === 'line' && <LineForm {...cat} />}

        {modal === 'station' && <StationForm {...cat} />}

        {modal === 'customer' && <CustomerForm {...cat} />}

        {modal === 'point' && (
          <PointForm {...pf} d={d} editingId={editingId} customerOpts={customerOpts}
            stationOpts={stationOpts} pointCodeOf={pointCodeOf} />
        )}
      </FormModal>

      {/* ============ Kết quả soát tên viết thường ============ */}
      {/* Dùng lại FormModal: nút xác nhận của nó chính là "Sửa tất cả". */}
      <FormModal wide open={lowNameOpen}
        title={`Soát tên viết thường — ${lowNameRows?.length ?? 0} khách hàng lệch`}
        onClose={() => setLowNameOpen(false)}
        onSubmit={() => void fixAllLowName()}
        saving={fixingLowName}
        submitLabel={`Sửa theo tên gốc (${autoFillable(lowNameRows ?? []).length})`}>
        <p className="text-sm text-soft">
          So <b>tên viết thường</b> với <b>tên khách hàng</b> — chỉ xét số ký tự và ký tự,
          <b> không phân biệt hoa/thường</b>. Viết hoa khác nhau không phải lỗi.
        </p>
        <div className="vl-alert vl-alert-light-warning">
          Tên gốc tải từ hóa đơn nên luôn đúng về chữ. Nút bên dưới lấy <b>ký tự</b> của tên
          gốc nhưng <b>giữ kiểu viết hoa</b> bạn đã soạn — xem cột "Đề nghị" trước khi bấm.
        </div>
        <TableCard fixed loading={false} isEmpty={!lowNameRows?.length} empty="Không có dòng nào lệch."
          columns={<>
            <th className={`${TH_CLS} w-[12%] pl-6`}>Mã KH</th>
            <th className={`${TH_CLS} w-[16%]`}>Lý do</th>
            <th className={`${TH_CLS} w-[24%]`}>Tên khách hàng</th>
            <th className={`${TH_CLS} w-[24%]`}>Đang lưu</th>
            <th className={`${TH_CLS} w-[24%] pr-6`}>Đề nghị</th>
          </>}>
          {(lowNameRows ?? []).map(r => (
            <tr key={r.id} className="transition-colors hover:bg-subtle/50">
              <td className="px-6 py-3 pl-6">
                <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{r.mkh}</span>
              </td>
              <td className="px-6 py-3">
                <span className={`text-xs font-bold ${r.issue === 'chars' ? 'text-bad' : 'text-warn'}`}>
                  {ISSUE_LABEL[r.issue]}
                </span>
                <p className="mt-0.5 text-[11px] leading-snug text-faint">{r.detail}</p>
              </td>
              <td className="truncate px-6 py-3 text-sm font-bold text-ink" title={r.name}>{r.name}</td>
              <td className="truncate px-6 py-3 text-sm text-soft" title={r.current}>
                {r.current || <span className="text-[11px] italic text-warn">chưa có</span>}
              </td>
              <td className="truncate px-6 py-3 pr-6 text-sm text-dim" title={r.expected}>{r.expected}</td>
            </tr>
          ))}
        </TableCard>
      </FormModal>
    </div>
  );
}
