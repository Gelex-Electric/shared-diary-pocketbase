/**
 * State + logic của FORM ĐIỂM ĐO (khai điểm đo, bảng vật tư treo tháo, đối
 * chiếu hóa đơn). Tách khỏi `CatalogEntry.tsx` ngày 17/11/2026 (plan
 * `2026-11-17-tach-catalog-entry.md`, đợt 4) — thân hook là NGUYÊN VĂN đoạn cũ.
 *
 * Luật thuần nằm ở `lib/dm/pointForm` (sửa dòng), `lib/dm/pointCheck` (kiểm tra),
 * `lib/dm/pointSave` (ghi). Hook này chỉ giữ state React và nối chúng lại.
 */
import { useEffect, useMemo, useState } from 'react';
import { Package, TriangleAlert, UserCheck, Zap } from 'lucide-react';
import type { CatalogData } from '../../../lib/dm/repo';
import { ASSET_LABEL } from '../../../lib/dm/types';
import type { AssetType, PointRole } from '../../../lib/dm/types';
import { deviceRatio, freeDevices, type SetOption } from '../../../lib/dm/tutiPick';
import { invoicesOfMkh, invoicesOfSerial } from '../../../lib/dm/invoiceRepo';
import { bySerial, segmentOf, segmentsOf } from '../../../lib/dm/lifecycle';
import type { Segment } from '../../../lib/dm/lifecycle';
import { checkPointForm, type MkhMeter } from '../../../lib/dm/pointCheck';
import {
  addRow as addRowIn, applyRowRules as applyRowRulesIn, applySet as applySetIn,
  liveElsewhere as liveElsewhereIn, lockedOn as lockedOnIn,
  ymdOf, type AssetRow, type RowCtx,
} from '../../../lib/dm/pointForm';
import type { NeedRow } from '../PointNeedEditor';
import type { CatTab } from './constants';

/** `code` cũng do hệ thống sinh; `customer` chỉ dùng khi là điểm đo phụ. */
export const EMPTY_P = {
  station: '', role: 'chinh' as PointRole,
  /** Chỉ cho điểm ĐẦU NGUỒN (schema v17): lộ nó đo + mã nhập tay (khớp LINE_NAME HES). */
  line: '', head_code: '',
  customer: '', parent_point: '', ident: '', hsn: '',
  /** Chỉ dùng khi điểm phụ trùng KH với điểm chính: mã nhãn, hoặc CUSTOM. */
  purpose: '', purpose_custom: '',
  note: '',
  /** Vật tư khai luôn cùng điểm đo — mỗi dòng một thiết bị (ghi vào dm_asset). */
  assetRows: [] as AssetRow[],
  /**
   * Nhu cầu vật tư (quy cách) — KINH DOANH khai ở form này (user chốt lại 27/10/2026);
   * Nhóm Vật Tư chỉ GẮN số No dự kiến, KD + VH ghi treo tháo. Xem `PointNeedEditor`.
   */
  need: [] as NeedRow[],
};

/** Trạng thái thiết bị trong ô chọn Số No — icon thay cho nhãn dài (28/09/2026). */
type SerialState = 'kho' | 'du_kien' | 'dang_treo';
export const SERIAL_STATE: Record<SerialState, { icon: typeof Package; cls: string; label: string }> = {
  kho: { icon: Package, cls: 'text-emerald-500', label: 'Trong kho' },
  du_kien: { icon: UserCheck, cls: 'text-amber-500', label: 'Đã gắn khách hàng dự kiến' },
  dang_treo: { icon: Zap, cls: 'text-red-500', label: 'Đang treo, hoạt động' },
};

export function usePointForm({ d, editingId, modal }: {
  d: CatalogData | null;
  editingId: string | null;
  /** Modal đang mở — chỉ tra hóa đơn khi form điểm đo đang mở. */
  modal: CatTab | null;
}) {
  /* Các hàm tra nhỏ — chép đúng định nghĩa trong `CatalogEntry`. */
  const mkhOf = (id?: string) => d?.customers.find(c => c.id === id)?.mkh;
  const customerMkh = (id?: string) => mkhOf(id) ?? '—';
  const pointCodeOf = (id?: string) => {
    const p = d?.points.find(x => x.id === id);
    return p?.code || p?.line_name || '(không rõ)';
  };

  /** Người dùng đã bấm "Sinh lại mã" cho điểm đo đang sửa. */
  const [regenCode, setRegenCode] = useState(false);

  const [pForm, setPForm] = useState(EMPTY_P);
  /**
   * Chữ ký HSN + vật tư lúc MỞ form sửa điểm đo — để chỉ chặn "TI×TU lệch HSN"
   * khi người dùng thực sự đụng vào phần đó (user chốt 28/09: dữ liệu cũ giữ
   * nguyên, mở ra sửa ghi chú không bị chặn). Điểm đo mới: rỗng ⇒ luôn chặn.
   */
  const [pSnap, setPSnap] = useState('');

  /** Dữ liệu mà luật bảng vật tư (`lib/dm/pointForm`) cần đọc. */
  const rowCtx: RowCtx = { devices: d?.devices ?? [], assets: d?.assets ?? [], editingId };

  /* ------------ Đối chiếu công tơ với hóa đơn (chỉ tham chiếu) ------------ */
  /**
   * Hóa đơn là nguồn CHUẨN NHẤT cho HSN (đối chiếu 8 điểm đo: 7 khớp tuyệt
   * đối, 1 lệch do khai sai tỷ số TI). Nhưng hóa đơn KHÔNG cho biết ngày treo /
   * ngày tháo — công tơ treo trước rồi mới dùng điện — nên ở đây chỉ HIỂN THỊ
   * để đối chiếu, tuyệt đối không tự điền vào ô nào.
   */
  const [invSegs, setInvSegs] = useState<Record<string, Segment[]>>({});
  const [invLoading, setInvLoading] = useState(false);

  /** MKH của điểm đo: điểm phụ mang KH riêng, điểm chính theo chủ trạm. */
  const pointMkh = mkhOf(pForm.customer || d?.stations.find(s => s.id === pForm.station)?.customer);

  /** Số chế tạo của các dòng công tơ — ngắn quá thì chưa gõ xong, đừng tra vội. */
  const meterSerials = useMemo(
    () => pForm.assetRows
      .filter(r => r.type === 'CONGTO' && r.serial.trim().length >= 6)
      .map(r => r.serial.trim()),
    [pForm.assetRows]);
  const serialKey = meterSerials.join('|');

  useEffect(() => {
    if (modal !== 'point') return;
    const missing = meterSerials.filter(s => !(s in invSegs));
    if (!missing.length) return;
    // Chờ người dùng gõ xong rồi mới tra, khỏi bắn một request mỗi ký tự.
    const timer = setTimeout(async () => {
      setInvLoading(true);
      try {
        const got: Record<string, Segment[]> = {};
        for (const s of missing) got[s] = segmentsOf(await invoicesOfSerial(s));
        setInvSegs(prev => ({ ...prev, ...got }));
      } catch {
        // Tra cứu hỏng thì thôi, không được chặn việc nhập liệu.
      } finally {
        setInvLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialKey, modal, invSegs]);

  /* ---- Đối chiếu NGƯỢC: khách hàng này trong hóa đơn dùng công tơ nào ---- */
  /**
   * Tra theo số công tơ chỉ trả lời được "số đang khai có thuộc khách này
   * không". Gõ nhầm sang một số không tồn tại thì không có hóa đơn nào và câu
   * hỏi đó im lặng. Hỏi từ phía khách hàng mới chỉ ra được số ĐÚNG là số nào.
   */
  const [mkhSerials, setMkhSerials] = useState<Record<string, MkhMeter[]>>({});

  useEffect(() => {
    if (modal !== 'point' || !pointMkh || pointMkh in mkhSerials) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await invoicesOfMkh(pointMkh);
        const out: MkhMeter[] = [];
        for (const [serial, list] of bySerial(rows)) {
          const seg = segmentOf(segmentsOf(list), pointMkh);
          if (seg) out.push({ serial, from: seg.from, to: seg.to, isCurrent: seg.isCurrent });
        }
        out.sort((a, b) => (a.to < b.to ? 1 : -1));
        if (!cancelled) setMkhSerials(prev => ({ ...prev, [pointMkh]: out }));
      } catch {
        // Tra cứu hỏng thì thôi — đối chiếu là tham chiếu, không được chặn nhập.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointMkh, modal, mkhSerials]);

  /* Kiểm tra form điểm đo: `lib/dm/pointCheck.ts` (thuần, có test). */
  const {
    pStation, pStationZone, pStationCustomer, pSubCustomer, isSub, isHead, pLine, lineHeadTaken,
    allLineOpts, sameCustomer, purposeLabel, mainTenant, subLabel, generatedCode, pointCodeMissing,
    codeLocked, pointCode, hsnFromPlan, ratioRowOf, hasTi, hsnInput, derivedHsn, activeSeg,
    invoiceHsn, tuRow, canFillTi, suggestedTi, meterRefs, invoiceNotes, refHsn, manualHsn,
    effectiveHsn, serialInForm, reclaim, hsnMismatch, setSuggestions, isNeedRow, treoRows, needRows,
    saveBlocks, assetWarnings, derivedStatus, statusReason,
  } = checkPointForm({ d, pForm, editingId, regenCode, pSnap, pointMkh, invSegs, mkhSerials });

  /** Điền tỷ số suy từ HSN hóa đơn cho CẢ BỘ TI đang hoạt động. */
  const fillTiFromInvoice = () =>
    setPForm(f => ({
      ...f,
      assetRows: f.assetRows.map(r =>
        r.type === 'TI' && r.active ? { ...r, ratio: suggestedTi } : r),
    }));

  /** Điền một ngày lấy từ hóa đơn vào đúng dòng công tơ đó. */
  const fillDate = (key: string, field: 'dateOn' | 'dateOff', value: string) =>
    setRow(key, { [field]: value });

  /**
   * Ô Số No CHỌN TỪ KHO (user chốt 28/09/2026 — plan
   * `2026-09-28-diem-do-chon-vat-tu-tu-kho-theo-hsn`, task 3): vật tư phải khai ở
   * tab Kho vật tư trước, form điểm đo không còn tạo thiết bị.
   *
   * - Bỏ thiết bị ĐÃ THANH LÝ và số No đã nằm ở dòng khác của form.
   * - Thiết bị rảnh xếp trước. Thiết bị đang treo ở điểm đo KHÁC vẫn hiện (xếp
   *   cuối, ghi rõ nơi treo) chứ không ẩn: khai lần lắp CŨ của nó và đổi chỗ
   *   giữa hai điểm đo dự kiến là hai luồng hợp lệ đã có — luật (4) và
   *   `reclaim`/`busyElsewhere` vẫn lo phần chặn.
   * - Số No hiện tại của dòng mà không có trong kho vẫn giữ trong danh sách,
   *   kèm nhãn, để ô không hiện trống với dữ liệu cũ.
   */
  const serialOptions = (r: AssetRow) => {
    const taken = new Set(pForm.assetRows.filter(x => x.key !== r.key).map(x => x.serial.trim()));
    const pool = (d?.devices ?? []).filter(dev => {
      const sn = dev.serial.trim();
      return !!sn && !taken.has(sn) && (!r.type || dev.type === r.type) && !ymdOf(dev.liquidated_at)
        // Dòng thêm từ bộ gợi ý theo HSN: chỉ đúng tỷ số của bộ đó.
        && (!r.want || r.id || deviceRatio(dev) === r.want);
    });
    const free = new Set(freeDevices(pool, d?.assets ?? [], { pointId: editingId }).map(x => x.id));
    /*
      Nhãn CHỈ là Số No + ICON trạng thái (user chốt 28/09/2026): nhãn dài
      "tỷ số · dành cho …" bị cắt trong ô hẹp của bảng. Chi tiết nằm ở `title`
      (rê chuột). Ba trạng thái — xem `SERIAL_STATE`:
        kho      — rảnh, chưa dành cho ai
        du_kien  — đã gắn khách hàng / điểm đo dự kiến
        dang_treo — đang treo, hoạt động ở điểm đo khác
    */
    const opts = pool
      .map(dev => {
        const sn = dev.serial.trim();
        const detail = [ASSET_LABEL[dev.type] ?? dev.type, deviceRatio(dev), dev.model_desc?.trim()];
        let state: SerialState = 'kho';
        if (!free.has(dev.id)) {
          const at = (d?.assets ?? []).find(a =>
            (a.device === dev.id || a.serial.trim() === sn) && a.date_on && !a.date_off
            && a.point !== editingId);
          state = 'dang_treo';
          detail.push(`đang treo ở ${pointCodeOf(at?.point)}`);
        } else if (dev.hold_point && dev.hold_point !== editingId) {
          state = 'du_kien';
          detail.push(`dành cho ${pointCodeOf(dev.hold_point)}`);
        } else if (dev.hold_for_customer || dev.hold_for_note?.trim()) {
          state = 'du_kien';
          detail.push(`dành cho ${[customerMkh(dev.hold_for_customer), dev.hold_for_note?.trim()]
            .filter(x => x && x !== '—').join(' · ')}`);
        }
        const s = SERIAL_STATE[state];
        return {
          value: sn, label: sn, icon: s.icon, iconClass: s.cls,
          title: `${s.label} — ${detail.filter(Boolean).join(' · ')}`,
          rank: state === 'kho' ? 0 : state === 'du_kien' ? 1 : 2,
        };
      })
      .sort((a, b) => a.rank - b.rank || a.value.localeCompare(b.value))
      .map(({ rank: _r, ...o }) => o);
    const cur = r.serial.trim();
    if (cur && !opts.some(o => o.value === cur)) {
      opts.unshift({ value: cur, label: cur, icon: TriangleAlert, iconClass: 'text-bad',
        title: 'Không có trong Kho vật tư' });
    }
    return opts;
  };


  /** Điểm đo chính trong cùng trạm — nguồn chọn cha cho điểm đo phụ. */
  const parentOpts = useMemo(
    () => (d?.points ?? [])
      .filter(p => p.role === 'chinh' && p.station === pForm.station && p.id !== editingId)
      .map(p => ({ value: p.id, label: p.code || p.line_name || p.id })),
    [d, pForm.station, editingId]);

  /* ------------- thao tác trên bảng vật tư của form điểm đo ------------- */

  /* Luật nằm ở `lib/dm/pointForm.ts` (thuần, có test) — đây chỉ nối với state của form. */
  const liveElsewhere = (serial: string) => liveElsewhereIn(rowCtx, serial);
  const lockedOn = (r: AssetRow) => lockedOnIn(rowCtx, r);

  const setRow = (key: string, patch: Partial<AssetRow>) =>
    setPForm(f => ({ ...f, assetRows: applyRowRulesIn(rowCtx, f.assetRows, key, patch) }));

  const applySet = (s: SetOption) =>
    setPForm(f => ({ ...f, assetRows: applySetIn(f.assetRows, s) }));

  const addRow = (type: AssetType | '' = '') =>
    setPForm(f => ({ ...f, assetRows: addRowIn(rowCtx, f.assetRows, type) }));
  const removeRow = (key: string) =>
    setPForm(f => ({ ...f, assetRows: f.assetRows.filter(r => r.key !== key) }));

  return {
    rowCtx, pointMkh, meterSerials, serialKey, fillTiFromInvoice, fillDate, serialOptions, parentOpts, liveElsewhere, lockedOn, setRow, applySet, addRow, removeRow, regenCode, setRegenCode, pForm, setPForm, pSnap, setPSnap, invSegs, setInvSegs, invLoading, setInvLoading, mkhSerials, setMkhSerials, pStation, pStationZone, pStationCustomer, pSubCustomer, isSub, isHead, pLine, lineHeadTaken, allLineOpts, sameCustomer, purposeLabel, mainTenant, subLabel, generatedCode, pointCodeMissing, codeLocked, pointCode, hsnFromPlan, ratioRowOf, hasTi, hsnInput, derivedHsn, activeSeg, invoiceHsn, tuRow, canFillTi, suggestedTi, meterRefs, invoiceNotes, refHsn, manualHsn, effectiveHsn, serialInForm, reclaim, hsnMismatch, setSuggestions, isNeedRow, treoRows, needRows, saveBlocks, assetWarnings, derivedStatus, statusReason,
  };
}

export type PointFormState = ReturnType<typeof usePointForm>;
