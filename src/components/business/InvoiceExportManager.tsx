/* ================================================================
   "Xuất dữ liệu" — mục con của nhóm Hồ sơ kinh doanh (khối Văn phòng).
   Xuất collection `invoice` ra Excel theo khoảng THÁNG đã chọn.

   Quy tắc user chốt 08/09/2026:
   - Lọc theo **EndDate**, bộ chọn là MonthPicker (từ tháng → đến tháng).
   - Xuất **toàn bộ trường** của collection, tiêu đề cột để tiếng Việt.
   - **Mỗi bản ghi một dòng** — không gộp các khoảng đổi giá cùng BillId,
     để file đúng nghĩa là bản sao của collection.
================================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, RefreshCw, FileSpreadsheet, Database, Users } from 'lucide-react';
import { pb } from '../../lib/pocketbase';
import {
  fetchLatestInvoiceMonth, fmtDate, fmtInt, zoneOf, ZONE_MAP,
  type InvoiceRecord,
} from '../../lib/invoices';
import { MonthPicker } from '../ui/DateTimePickers';
import { Select } from '../ui/Select';
import { Tabs, TabItem } from '../ui/Tabs';
import { toast as notify } from '../../lib/toast';
import { StatTile, EmptyState } from '../ui/dashboard';

/* Cột xuất: [tên trường trong PocketBase, tiêu đề tiếng Việt, kiểu].
   'date' → dd/mm/yyyy; 'num' → để nguyên dạng SỐ cho Excel tính được; 'text' → chuỗi.
   Thứ tự ở đây chính là thứ tự cột trong file Excel. */
type ColKind = 'text' | 'num' | 'date';
const COLUMNS: [field: string, label: string, kind: ColKind][] = [
  ['MKHang',    'Mã khách hàng',            'text'],
  ['NMua',      'Tên khách hàng',           'text'],
  ['DChiNMua',  'Địa chỉ sử dụng điện',     'text'],
  ['SCT',       'Số công tơ',               'text'],
  ['HSN',       'Hệ số nhân',               'num'],
  ['StartDate', 'Từ ngày',                  'date'],
  ['EndDate',   'Đến ngày',                 'date'],
  ['LoaiHD',    'Loại hóa đơn',             'text'],
  ['BT_dau',    'Chỉ số đầu BT',            'num'],
  ['BT_cuoi',   'Chỉ số cuối BT',           'num'],
  ['CD_dau',    'Chỉ số đầu CĐ',            'num'],
  ['CD_cuoi',   'Chỉ số cuối CĐ',           'num'],
  ['TD_dau',    'Chỉ số đầu TĐ',            'num'],
  ['TD_cuoi',   'Chỉ số cuối TĐ',           'num'],
  ['VC_dau',    'Chỉ số đầu vô công',       'num'],
  ['VC_cuoi',   'Chỉ số cuối vô công',      'num'],
  ['phu_BT',    'Phụ trừ BT',               'num'],
  ['phu_CD',    'Phụ trừ CĐ',               'num'],
  ['phu_TD',    'Phụ trừ TĐ',               'num'],
  ['phu_VC',    'Phụ trừ vô công',          'num'],
  ['SL_BT',     'Sản lượng BT (kWh)',       'num'],
  ['SL_CD',     'Sản lượng CĐ (kWh)',       'num'],
  ['SL_TD',     'Sản lượng TĐ (kWh)',       'num'],
  ['TongSL_HC', 'Tổng sản lượng hữu công (kWh)',   'num'],
  ['TongSL_PK', 'Tổng sản lượng phản kháng (kVarh)', 'num'],
  ['CosFi',     'Cos φ',                    'num'],
  ['KCosFi',    'Hệ số Cos φ',              'num'],
  ['ThTien',    'Thành tiền trước thuế (đ)', 'num'],
  ['VAT',       'Thuế suất',                'num'],
  ['ThTienVAT', 'Thành tiền sau thuế (đ)',  'num'],
  ['NTToan',    'Ngày thanh toán',          'date'],
  ['NKy',       'Người ký',                 'text'],
  ['NBan',      'Bên bán',                  'text'],
  ['DChiNBan',  'Địa chỉ bên bán',          'text'],
  ['BillId',    'Mã hóa đơn (BillId)',      'text'],
  ['IndexId',   'Mã chỉ số (IndexId)',      'text'],
  ['id',        'ID bản ghi',               'text'],
  ['created',   'Ngày tạo',                 'date'],
  ['updated',   'Ngày cập nhật',            'date'],
];

/* Tab "Theo khách hàng": cộng dồn các bản ghi cùng MKHang trong khoảng tháng.

   ⚠️ ĐÃ KIỂM CHỨNG TRÊN DỮ LIỆU THẬT 08/09/2026 (bản ghi SCT 2410131378, HSN 200):
     BT (753,82−579,28)×200 = 34.908 − phu_BT 24.017 = 10.891 = SL_BT đang lưu
     CĐ 14.606 − 8.536 = 6.070 = SL_CD ; TĐ 7.726 − 7.405 = 321 = SL_TD
     TongSL_HC = 10.891+6.070+321 = 17.282
   ⇒ SL_BT/CD/TD và TongSL_HC LƯU TRONG DB **ĐÃ TRỪ PHỤ TRỪ** — tức đã là sản lượng
   cuối dùng để tính tiền. Vì vậy cột "Sản lượng hữu công" lấy THẲNG Σ TongSL_HC;
   trừ `phu_*` thêm một lần nữa là SAI (số sẽ âm). User chốt 08/09/2026: chỉ hiện
   sản lượng hữu công, không cần tách cột trực tiếp / phụ trừ. */
interface CustomerSum {
  mkh: string;
  name: string;
  start: string;    // StartDate sớm nhất
  end: string;      // EndDate muộn nhất
  slHC: number;     // kWh hữu công (đã trừ phụ trừ) = Σ TongSL_HC
  slPK: number;     // kVarh vô công
  tien: number;     // trước thuế
  tienVAT: number;  // sau thuế
  count: number;    // số bản ghi đã gộp
}

const CUSTOMER_COLUMNS: [keyof CustomerSum, string, ColKind][] = [
  ['start',   'Từ ngày',                             'date'],
  ['end',     'Đến ngày',                            'date'],
  ['name',    'Tên khách hàng',                      'text'],
  ['mkh',     'Mã khách hàng',                       'text'],
  ['slHC',    'Sản lượng hữu công (kWh)',            'num'],
  ['slPK',    'Sản lượng vô công (kVarh)',           'num'],
  ['tien',    'Thành tiền trước thuế (đ)',           'num'],
  ['tienVAT', 'Thành tiền sau thuế (đ)',             'num'],
  ['count',   'Số bản ghi gộp',                      'num'],
];

const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];
const p2 = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; };
/** Đầu tháng kế tiếp của "YYYY-MM" — dùng làm cận trên (nửa mở) cho bộ lọc EndDate. */
const nextMonthStart = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${p2(m + 1)}-01`;
};
const monthLabel = (ym: string) => (ym ? `${ym.slice(5)}/${ym.slice(0, 4)}` : '');

/** Giá trị một ô Excel: số giữ kiểu số, ngày về dd/mm/yyyy, còn lại là chuỗi. */
function cellValue(rec: InvoiceRecord, field: string, kind: ColKind): string | number {
  const raw = rec[field];
  if (raw === undefined || raw === null || raw === '') return kind === 'num' ? 0 : '';
  if (kind === 'num') { const n = Number(raw); return Number.isFinite(n) ? n : 0; }
  if (kind === 'date') return fmtDate(String(raw));
  return String(raw);
}

type ViewTab = 'raw' | 'by-customer';
const VIEW_TABS: TabItem<ViewTab>[] = [
  { id: 'raw', label: 'Chi tiết theo công tơ', icon: Database, sub: 'Toàn bộ trường, mỗi bản ghi một dòng' },
  { id: 'by-customer', label: 'Theo khách hàng', icon: Users, sub: 'Cộng dồn theo mã khách hàng' },
];

export default function InvoiceExportManager() {
  const [tab, setTab] = useState<ViewTab>('raw');
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [zone, setZone] = useState('');           // '' = tất cả KCN
  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);    // đã tải ít nhất 1 lần

  /* Mặc định: tháng mới nhất có hóa đơn (fallback tháng hiện tại) */
  useEffect(() => {
    let mounted = true;
    fetchLatestInvoiceMonth().then(ym => {
      if (!mounted) return;
      const m = ym || thisMonth();
      setFromMonth(prev => prev || m);
      setToMonth(prev => prev || m);
    });
    return () => { mounted = false; };
  }, []);

  // Chọn ngược (từ > đến) thì đảo lại khi truy vấn, khỏi trả về rỗng vô cớ
  const [start, endExclusive] = useMemo(() => {
    if (!fromMonth || !toMonth) return ['', ''];
    const [a, b] = fromMonth <= toMonth ? [fromMonth, toMonth] : [toMonth, fromMonth];
    return [`${a}-01`, nextMonthStart(b)];
  }, [fromMonth, toMonth]);

  const load = useCallback(async () => {
    if (!start || !endExclusive) return;
    setIsLoading(true);
    try {
      const list = await pb.collection('invoice').getFullList<InvoiceRecord>({
        filter: pb.filter('EndDate >= {:start} && EndDate < {:end}', { start, end: endExclusive }),
        sort: 'EndDate,MKHang,SCT',
        requestKey: null,
      });
      setRecords(list);
      setLoaded(true);
    } catch (err: any) {
      notify.error('Lỗi tải dữ liệu', err?.message || 'Không đọc được collection invoice');
      setRecords([]);
      setLoaded(true);
    } finally {
      setIsLoading(false);
    }
  }, [start, endExclusive]);

  useEffect(() => { load(); }, [load]);

  /* Lọc KCN theo tiền tố mã khách hàng (KCNTH-002 → KCNTH) */
  const rows = useMemo(
    () => (zone ? records.filter(r => zoneOf(r.MKHang || '') === zone) : records),
    [records, zone],
  );

  /* Gộp theo mã khách hàng — kỳ hiển thị là StartDate sớm nhất → EndDate muộn nhất */
  const byCustomer = useMemo<CustomerSum[]>(() => {
    const map = new Map<string, CustomerSum>();
    for (const r of rows) {
      const mkh = (r.MKHang || '').trim() || '(Không mã)';
      let c = map.get(mkh);
      if (!c) {
        c = {
          mkh, name: r.NMua || '', start: '', end: '',
          slHC: 0, slPK: 0, tien: 0, tienVAT: 0, count: 0,
        };
        map.set(mkh, c);
      }
      if (!c.name && r.NMua) c.name = r.NMua;
      const s = dateOnly(r.StartDate);
      const e = dateOnly(r.EndDate);
      if (s && (!c.start || s < c.start)) c.start = s;
      if (e && (!c.end || e > c.end)) c.end = e;
      // TongSL_HC đã là sản lượng SAU phụ trừ (xem chú thích ở CustomerSum)
      c.slHC += Number(r.TongSL_HC) || 0;
      c.slPK += Number(r.TongSL_PK) || 0;
      c.tien += Number(r.ThTien) || 0;
      c.tienVAT += Number(r.ThTienVAT) || 0;
      c.count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.tienVAT - a.tienVAT);
  }, [rows]);

  const summary = useMemo(() => {
    const customers = new Set<string>();
    let tien = 0;
    for (const r of rows) {
      if (r.MKHang) customers.add(r.MKHang);
      tien += Number(r.ThTienVAT) || 0;
    }
    return { customers: customers.size, tien };
  }, [rows]);

  /** Xuất Excel theo TAB đang xem: chi tiết bản ghi, hoặc bảng gộp theo khách hàng. */
  const exportToExcel = () => {
    const isRaw = tab === 'raw';
    const count = isRaw ? rows.length : byCustomer.length;
    if (count === 0) { notify.show('warning', 'Lưu ý', 'Không có dữ liệu để xuất'); return; }

    const headers = (isRaw ? COLUMNS : CUSTOMER_COLUMNS).map(c => c[1] as string);
    const data = isRaw
      ? rows.map(r => {
          const o: Record<string, string | number> = {};
          for (const [field, label, kind] of COLUMNS) o[label] = cellValue(r, field, kind);
          return o;
        })
      : byCustomer.map(c => {
          const o: Record<string, string | number> = {};
          for (const [field, label, kind] of CUSTOMER_COLUMNS) {
            const raw = c[field];
            o[label] = kind === 'date' ? fmtDate(String(raw || '')) : kind === 'num' ? Number(raw) || 0 : String(raw ?? '');
          }
          return o;
        });

    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    ws['!cols'] = headers.map(label => ({ wch: Math.min(Math.max(label.length + 2, 12), 40) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isRaw ? 'invoice' : 'TheoKhachHang');
    const a = fromMonth <= toMonth ? fromMonth : toMonth;
    const b = fromMonth <= toMonth ? toMonth : fromMonth;
    const range = a === b ? a : `${a}_${b}`;
    const prefix = isRaw ? 'HoaDon' : 'HoaDon_TheoKhachHang';
    XLSX.writeFile(wb, `${prefix}_${range}${zone ? `_${zone}` : ''}.xlsx`);
    notify.show('success', 'Đã xuất', `${fmtInt(count)} ${isRaw ? 'bản ghi' : 'khách hàng'} ra file Excel`);
  };

  const rangeText = start
    ? (fromMonth === toMonth ? `tháng ${monthLabel(fromMonth)}` : `tháng ${monthLabel(fromMonth)} – ${monthLabel(toMonth)}`)
    : '';

  return (
    <div className="space-y-6 pb-6">

      {/* ---- Thanh công cụ ---- */}
      <div className="vl-card p-5 md:p-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-accent-soft rounded-2xl text-accent">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-black text-ink tracking-tight uppercase">Xuất dữ liệu hóa đơn</h1>
          </div>
          <p className="text-sm text-soft max-w-2xl flex items-start gap-1.5">
            <Database className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
            {tab === 'raw' ? (
              <span>
                Xuất toàn bộ trường của collection <code>invoice</code> ra Excel, lọc theo{' '}
                <strong>Đến ngày (EndDate)</strong> nằm trong khoảng tháng đã chọn. Mỗi bản ghi là một dòng —
                hóa đơn đổi giá giữa kỳ sẽ có nhiều dòng cùng mã hóa đơn.
              </span>
            ) : (
              <span>
                Cộng dồn theo <strong>mã khách hàng</strong> trong khoảng tháng đã chọn. Sản lượng và tiền lấy
                thẳng từ hóa đơn (<code>TongSL_HC</code>, <code>TongSL_PK</code>, <code>ThTien</code>,{' '}
                <code>ThTienVAT</code>) — các số này <strong>đã trừ phụ trừ</strong>, là số cuối dùng để tính tiền.
              </span>
            )}
          </p>
        </div>

        <div className="shrink-0 flex flex-wrap items-end gap-3">
          <MonthPicker value={fromMonth} onChange={setFromMonth} label="Từ tháng" className="w-[170px]" />
          <MonthPicker value={toMonth} onChange={setToMonth} label="Đến tháng" className="w-[170px]" />
          <div className="w-[190px]">
            <label className="block text-[11px] font-semibold text-faint uppercase tracking-wider mb-1">Khu công nghiệp</label>
            <Select
              value={zone}
              onChange={setZone}
              options={[
                { value: '', label: 'Tất cả KCN' },
                ...Object.entries(ZONE_MAP).map(([code, name]) => ({ value: code, label: name })),
              ]}
              className="w-full"
            />
          </div>
          <button type="button" onClick={load} disabled={isLoading} className="vl-btn vl-btn-outline-primary">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Tải lại
          </button>
          <button type="button" onClick={exportToExcel} disabled={isLoading || rows.length === 0} className="vl-btn vl-btn-primary">
            <Download className="w-4 h-4" />
            Xuất Excel
          </button>
        </div>
      </div>

      {/* ---- Thanh tab ---- */}
      <Tabs<ViewTab> tabs={VIEW_TABS} value={tab} onChange={setTab} />

      {/* ---- Ô số liệu ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile
          label={tab === 'raw' ? 'Số bản ghi' : 'Số dòng gộp'}
          value={fmtInt(tab === 'raw' ? rows.length : byCustomer.length)}
          unit="dòng"
          loading={isLoading}
          tone="accent"
        />
        <StatTile label="Số khách hàng" value={fmtInt(summary.customers)} unit="KH" loading={isLoading} tone="neutral" />
        <StatTile label="Tổng tiền sau thuế" value={fmtInt(summary.tien)} unit="đ" loading={isLoading} tone="ok" />
      </div>

      {/* ---- Xem trước ---- */}
      <div className="vl-card p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-bold text-ink uppercase tracking-wide">
            Xem trước {rangeText && `— ${rangeText}`}
          </h3>
          {tab === 'raw' && rows.length > 20 && (
            <span className="text-xs text-faint font-medium">
              Hiện 20 dòng đầu · file Excel xuất đủ {fmtInt(rows.length)} dòng
            </span>
          )}
        </div>

        {isLoading ? (
          <EmptyState icon={RefreshCw} title="Đang tải dữ liệu hóa đơn…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title={loaded ? 'Không có hóa đơn nào trong khoảng đã chọn' : 'Chọn khoảng tháng để xem dữ liệu'}
            hint={loaded ? 'Thử mở rộng khoảng tháng hoặc bỏ lọc khu công nghiệp.' : undefined}
          />
        ) : tab === 'by-customer' ? (
          <div className="overflow-x-auto">
            <table className="vl-table w-full border-collapse text-left" style={{ minWidth: 1000 }}>
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {CUSTOMER_COLUMNS.map(([field, label, kind]) => (
                    <th key={field} className={`whitespace-nowrap ${kind === 'num' ? 'text-right' : ''}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {byCustomer.map(c => (
                  <tr key={c.mkh}>
                    {CUSTOMER_COLUMNS.map(([field, , kind]) => {
                      const raw = c[field];
                      return (
                        <td
                          key={field}
                          className={kind === 'num' ? 'text-right tabular-nums whitespace-nowrap' : 'whitespace-nowrap'}
                        >
                          {kind === 'date'
                            ? fmtDate(String(raw || ''))
                            : kind === 'num'
                              ? fmtInt(Number(raw) || 0)
                              : String(raw ?? '') || '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-faint mt-3">
              Bảng hiện đủ {fmtInt(byCustomer.length)} khách hàng, xếp theo tiền sau thuế giảm dần.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="vl-table w-full border-collapse text-left" style={{ minWidth: 1100 }}>
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {COLUMNS.slice(0, 10).map(([field, label]) => (
                    <th key={field} className="whitespace-nowrap">{label}</th>
                  ))}
                  <th className="whitespace-nowrap text-right">Tiền sau thuế (đ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.slice(0, 20).map(r => (
                  <tr key={r.id}>
                    {COLUMNS.slice(0, 10).map(([field, , kind]) => (
                      <td key={field} className={kind === 'num' ? 'text-right tabular-nums whitespace-nowrap' : 'whitespace-nowrap'}>
                        {kind === 'num' ? fmtInt(Number(cellValue(r, field, kind)) || 0) : cellValue(r, field, kind) || '—'}
                      </td>
                    ))}
                    <td className="text-right tabular-nums font-semibold whitespace-nowrap">
                      {fmtInt(Number(r.ThTienVAT) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-faint mt-3">
              Bảng xem trước hiện 10 cột đầu; file Excel có đủ {COLUMNS.length} cột.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
