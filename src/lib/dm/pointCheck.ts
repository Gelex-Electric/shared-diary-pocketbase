/**
 * KIỂM TRA FORM ĐIỂM ĐO — module THUẦN (không React, không PocketBase), test:
 * `npx tsx scripts/dm_test_point_check.ts`.
 *
 * Tách khỏi `components/dm/CatalogEntry.tsx` ngày 17/11/2026 (plan
 * `2026-11-17-tach-catalog-entry.md`, đợt 2). Thân hàm là NGUYÊN VĂN khối cũ
 * — giữ cả tên biến (`d`, `pForm`, `editingId`…) để đối chiếu dòng với lịch sử
 * git. Những gì trước đây đọc qua closure của component nay là tham số.
 *
 * Gồm: sinh mã điểm đo, suy HSN từ TI/TU, đối chiếu hóa đơn, trùng số No,
 * đổi chỗ/chuyển vật tư dự kiến, 5 nhóm CHẶN LƯU, cảnh báo, trạng thái suy ra.
 */
import { ASSET_LABEL } from './types';
import type { AssetType, PointRole } from './types';
import type { CatalogData } from './repo';
import { deriveHsn, hsnFormula, parseRatio, pickRatio } from './hsn';
import { freeDevices, parseHsnInput, setMatchesHsn, suggestSets } from './tutiPick';
import { REMOTE_LABEL, TI_PER_SET, countAssets, derivePointStatus, missingRemote, overCap } from './pointStatus';
import { dmy, dmyRange, segmentFor, segmentOf } from './lifecycle';
import type { Segment } from './lifecycle';
import { buildPointCode, missingPointCodeParts, normalizeShortName } from './naming';
import { HAS_RATIO } from './supply';
import { deviceOf as deviceOfIn, hsnSig, ymdOf, type AssetRow } from './pointForm';

/** Giá trị đặc biệt của bộ chọn nhãn mục đích: cho gõ tay chuỗi bất kỳ. */
export const CUSTOM = '__custom';

/** Một số công tơ mà hóa đơn ghi cho một mã khách hàng, kèm quãng phát sinh. */
export interface MkhMeter { serial: string; from: string; to: string; isCurrent: boolean; }

/** Phần form điểm đo mà phép kiểm cần đọc. */
export interface PointFormLike {
  station: string;
  role: PointRole;
  line: string;
  customer: string;
  parent_point: string;
  ident: string;
  hsn: string;
  purpose: string;
  purpose_custom: string;
  assetRows: AssetRow[];
}

export interface PointCheckInput {
  d: CatalogData | null;
  pForm: PointFormLike;
  /** Điểm đo đang sửa; `null` = thêm mới. */
  editingId: string | null;
  /** Người dùng đã bấm "Sinh lại mã". */
  regenCode: boolean;
  /** Chữ ký HSN + vật tư lúc mở form (`hsnSig`); rỗng = điểm đo mới. */
  pSnap: string;
  /** MKH của điểm đo (điểm phụ: KH riêng; điểm chính: chủ trạm). */
  pointMkh: string | undefined;
  /** Chặng hóa đơn theo số công tơ (đã tra). */
  invSegs: Record<string, Segment[]>;
  /** Công tơ mà hóa đơn ghi cho từng MKH (đã tra). */
  mkhSerials: Record<string, MkhMeter[]>;
}

export function checkPointForm({
  d, pForm, editingId, regenCode, pSnap, pointMkh, invSegs, mkhSerials,
}: PointCheckInput) {
  /* Các hàm tra nhỏ — chép đúng định nghĩa trong component. */
  const customerMkh = (id?: string) => d?.customers.find(c => c.id === id)?.mkh ?? '—';
  const pointCodeOf = (id?: string) => {
    const p = d?.points.find(x => x.id === id);
    return p?.code || p?.line_name || '(không rõ)';
  };
  const deviceOf = (serial: string) =>
    deviceOfIn({ devices: d?.devices ?? [], assets: d?.assets ?? [], editingId }, serial);

  /* ------------------ mã điểm đo do hệ thống sinh ------------------ */
  const pStation = d?.stations.find(s => s.id === pForm.station);
  const pStationZone = d?.zones.find(z => z.id === pStation?.zone);
  const pStationCustomer = d?.customers.find(c => c.id === pStation?.customer);
  const pSubCustomer = d?.customers.find(c => c.id === pForm.customer);
  const isSub = pForm.role === 'phu';
  /** Điểm đo ĐẦU NGUỒN: đo tổng một lộ, không trạm, không khách (schema v17). */
  const isHead = pForm.role === 'dau_nguon';
  const pLine = d?.lines.find(l => l.id === pForm.line);
  /** Lộ đã có điểm đầu nguồn khác — mỗi lộ một điểm (plan 24/09). */
  const lineHeadTaken = isHead && !!pForm.line && (d?.points ?? [])
    .some(p => p.role === 'dau_nguon' && p.line === pForm.line && p.id !== editingId);
  /** Mọi lộ, nhãn kèm KCN — điểm đầu nguồn chọn lộ trực tiếp, không qua trạm. */
  const allLineOpts = (d?.lines ?? []).map(l => ({
    value: l.id,
    label: `${l.code} — ${d?.zones.find(z => z.id === l.zone)?.name ?? '—'}${l.active === false ? ' (đã ngưng)' : ''}`,
  }));

  /** Điểm đo chính mà điểm phụ này thuộc về (nếu đã chọn). */
  const pParent = d?.points.find(p => p.id === pForm.parent_point);
  /**
   * Điểm phụ TRÙNG khách hàng với điểm chính → lấy tên tắt KH làm đuôi sẽ
   * lặp y hệt phần đầu mã, không phân biệt được. Khi đó dùng nhãn mục đích.
   * Chưa chọn điểm chính thì so với chủ trạm.
   */
  const parentCustomerId = pParent?.customer ?? pStation?.customer ?? '';
  const sameCustomer = isSub && !!pForm.customer && pForm.customer === parentCustomerId;

  const purposeLabel = pForm.purpose === CUSTOM
    ? normalizeShortName(pForm.purpose_custom)
    : pForm.purpose;

  /**
   * Điểm đo chính có thể thuộc khách hàng KHÁC chủ trạm — chủ nhà xưởng cho
   * thuê là mô hình phổ biến (`YM.TITAN.NX9.750kVA` của TITAN nhưng điểm đo là
   * của ANGSTROM). Lúc đó mã cần đuôi tên tắt khách thuê để phân biệt các điểm
   * đo chính trong cùng một trạm, và để khớp `LINE_NAME` bên HES.
   */
  const mainTenant = !isSub && !!pForm.customer && pForm.customer !== pStation?.customer;

  /**
   * Đuôi mã, theo thứ tự ưu tiên:
   *
   *  1. **Nhãn mục đích** nếu người dùng có chọn — ô này nay LUÔN hiện, cho mọi
   *     điểm đo (user chốt 25/08/2026). Người khai chủ động đặt tên thì tôn
   *     trọng, không đoán hộ.
   *  2. Không chọn nhãn thì suy như cũ:
   *     - điểm phụ  : tên tắt KH phụ (bỏ trống nếu trùng KH với điểm chính, vì
   *                   lấy tên tắt sẽ lặp y hệt phần đầu mã)
   *     - điểm chính: tên tắt khách thuê khi khác chủ trạm
   */
  const subLabel = purposeLabel
    ? purposeLabel
    : isSub
      ? (sameCustomer ? '' : (pSubCustomer?.short_name ?? ''))
      : (mainTenant ? (pSubCustomer?.short_name ?? '') : '');

  const pointParts = {
    zoneCode: pStationZone?.code ?? '',
    customerShortName: pStationCustomer?.short_name ?? '',
    ident: pStation?.ident ?? '',
    sdmKva: pStation?.sdm_kva ?? null,   // công suất lấy theo trạm chứa nó
    isSub,
    subLabel,
    pointIdent: pForm.ident,
  };
  const generatedCode = buildPointCode(pointParts);
  const pointCodeMissing = missingPointCodeParts(pointParts);

  /**
   * Điểm đo ĐÃ TỪNG CHUYỂN CHỦ THỂ thì GIỮ NGUYÊN mã đã lưu (user chốt
   * 27/08/2026).
   *
   * Mã nhúng tên tắt khách hàng, nên sau khi chuyển chủ mà mở form sửa rồi lưu
   * là mã tự mọc thêm đuôi tên tắt chủ mới — đúng thứ vừa cố tránh. Mã điểm đo
   * chính là `LINE_NAME` bên HES: đổi là lệch với dữ liệu đo đếm.
   *
   * Vẫn đổi được, nhưng phải bấm nút "Sinh lại mã" — cố ý, không âm thầm.
   */
  const savedPoint = editingId ? d?.points.find(p => p.id === editingId) : undefined;
  const codeLocked = !!savedPoint?.owner_history?.length && !regenCode;
  const lockedCode = savedPoint?.code ?? '';
  const pointCode = codeLocked && lockedCode ? lockedCode : generatedCode;

  /* ------------- HSN suy từ tỷ số TI / TU trong bảng vật tư ------------- */
  /**
   * VẬT TƯ DỰ KIẾN = dòng đã khai nhưng CHƯA CÓ NGÀY TREO (user chốt
   * 25/08/2026). Đó là cách khai kế hoạch ngay tại điểm đo, không cần màn riêng:
   * mua sẵn bộ TI 1500/5 để thay cho bộ 1000/5 đang chạy thì cứ thêm 3 dòng, để
   * trống ngày treo. Chừng nào chưa có ngày treo thì dòng đó KHÔNG được:
   *   - kéo HSN theo tỷ số của nó,
   *   - biến điểm đo đo thẳng thành đo gián tiếp,
   *   - lấy gì từ hóa đơn.
   * Ngày treo là mốc duy nhất chứng minh vật tư đã ra hiện trường.
   */
  const isHung = (r: AssetRow) => !!r.dateOn.trim();

  /**
   * BỘ DÒNG DÙNG ĐỂ SUY HSN.
   *
   * Mặc định chỉ xét vật tư ĐÃ TREO — đó mới là cái đang đo thật. Nhưng khi
   * CHƯA CÓ DÒNG NÀO ĐƯỢC TREO (điểm đo dự kiến), lấy chính các dòng dự kiến
   * để suy HSN (user chốt 27/08/2026): khai bộ TI 200/5 cho điểm đo sắp lắp mà
   * ô HSN vẫn trống thì không kiểm tra được gì trước khi ra hiện trường, và
   * điểm đo dự kiến hiện HSN rỗng khắp nơi trong danh mục.
   *
   * KHÔNG trộn hai loại: có dù chỉ một dòng đã treo thì dòng dự kiến lại đứng
   * ngoài như cũ — bộ TI mua sẵn 1500/5 không được kéo HSN của bộ 1000/5 đang
   * chạy.
   */
  const hungRows = pForm.assetRows.filter(isHung);
  const hsnRows = hungRows.length ? hungRows : pForm.assetRows;
  /** HSN đang suy từ vật tư DỰ KIẾN — cần nói rõ, kẻo tưởng đã lắp xong. */
  const hsnFromPlan = hungRows.length === 0
    && pForm.assetRows.some(r => r.type && r.serial.trim());

  /**
   * Lấy dòng đầu tiên của một loại có nhập tỷ số — 3 TI cùng bộ luôn cùng tỷ số.
   */
  const ratioRowOf = (type: AssetType) =>
    hsnRows.find(r => r.active && r.type === type && r.ratio.trim() !== '');

  /**
   * Tỷ số đại diện của một bộ: ưu tiên cái đang hoạt động, cả bộ đã tháo thì
   * lấy cái tháo sau cùng — xem `pickRatio`. Không làm vậy thì điểm đo đã tháo
   * mất sạch HSN.
   */
  const ratioOfSet = (type: AssetType) =>
    pickRatio(hsnRows
      .filter(r => r.type === type && r.ratio.trim() !== '')
      .map(r => ({ ...parseRatio(r.ratio), active: r.active })));

  /**
   * Có khai TI hay không thay cho câu hỏi "đấu nối" đã bỏ khỏi form. Xét CẢ TI
   * đã tháo: điểm đo từng đo gián tiếp thì vẫn là gián tiếp, tháo TI ra không
   * biến nó thành đo thẳng. Nhưng KHÔNG xét TI dự kiến (chưa có ngày treo) —
   * bộ TI mua sẵn không biến điểm đo đang đo thẳng thành đo gián tiếp — trừ khi
   * CẢ điểm đo còn dự kiến, lúc đó không có gì khác để dựa vào.
   */
  const hasTi = hsnRows.some(r => r.type === 'TI');
  const hsnInput = { hasTi, ti: ratioOfSet('TI'), tu: ratioOfSet('TU') };
  const derivedHsn = deriveHsn(hsnInput);


  /**
   * Công tơ ĐANG hoạt động — HSN của điểm đo phải khớp hóa đơn của cái này.
   *
   * KHÔNG lọc theo `isHung` ở đây: lúc vừa gõ số công tơ thì chưa có ngày treo,
   * mà đó chính là lúc người dùng cần khối đối chiếu để biết điền ngày nào.
   */
  const activeMeter = pForm.assetRows.find(r =>
    r.type === 'CONGTO' && r.active && r.serial.trim());
  const activeSegs = invSegs[activeMeter?.serial.trim() ?? ''] ?? [];
  /**
   * Ưu tiên chặng GIAO với quãng treo đã khai; chưa khai ngày, hoặc khai lệch
   * quãng, thì vẫn lấy chặng của đúng khách hàng để hiển thị — chỗ lệch sẽ được
   * nói riêng ở `invoiceNotes`, im lặng thì người dùng không biết đường nào mà lần.
   */
  const activeSeg = segmentFor(activeSegs, pointMkh, activeMeter?.dateOn, activeMeter?.dateOff)
    ?? segmentOf(activeSegs, pointMkh);
  const invoiceHsn = activeSeg?.hsn;

  /**
   * Chỉ suy ngược được tỷ số TI khi KHÔNG có TU: khi đó HSN = TI sơ/TI thứ.
   * Có cả TU thì một HSN ứng với vô số cặp tỷ số — phải nhập tay cả hai, app
   * chỉ kiểm tích số (user chốt 20/08).
   */
  const tuRow = ratioRowOf('TU');
  const tiSecondary = parseRatio(ratioRowOf('TI')?.ratio ?? '').secondary ?? 5;
  const canFillTi = hasTi && invoiceHsn != null && !tuRow
    && pForm.assetRows.some(r => r.type === 'TI' && r.active);
  const suggestedTi = invoiceHsn != null ? `${invoiceHsn * tiSecondary}/${tiSecondary}` : '';


  /**
   * Mỗi dòng công tơ kèm chặng hóa đơn của đúng khách hàng của điểm đo. Liệt kê
   * CẢ công tơ đã tháo — điểm đo ngưng hoạt động vẫn phải khớp HSN hóa đơn.
   */
  const meterRefs = pForm.assetRows
    .filter(r => r.type === 'CONGTO' && r.serial.trim())
    .map(r => {
      const segs = invSegs[r.serial.trim()];
      if (!segs) return null;
      // Hai mức ghép: `mine` = chặng của đúng khách hàng (MKH + số công tơ),
      // `inWindow` = chặng đó có GIAO với quãng treo đã khai hay không. Tách ra
      // vì "sai khách" và "sai ngày" là hai lỗi khác nhau, phải nhắc khác nhau.
      const mine = segmentOf(segs, pointMkh);
      const inWindow = segmentFor(segs, pointMkh, r.dateOn, r.dateOff);
      return { row: r, segs, mine, inWindow };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);


  /** Nhắc đối chiếu hóa đơn — tách khỏi `assetWarnings` vì đây là tham chiếu. */
  /**
   * Các số công tơ mà hóa đơn ghi cho ĐÚNG khách hàng này — dùng để gợi ý số
   * đúng khi số đang khai chưa từng phát sinh hóa đơn.
   */
  const mkhMeters = (pointMkh ? mkhSerials[pointMkh] : undefined) ?? [];

  const invoiceNotes: string[] = [];
  for (const { row: r, segs, mine, inWindow } of meterRefs) {
    const serial = r.serial.trim();

    /*
      CẶP (MKH + số công tơ + ngày đã khai) MÀ CÓ HÓA ĐƠN ⇒ IM LẶNG HOÀN TOÀN
      (user chốt 27/08/2026). `inWindow` chính là phép kiểm đó: chặng của đúng
      khách hàng, và giao với quãng treo đang khai. Khớp rồi thì không còn gì
      để nhắc về chuyện "có hóa đơn hay chưa".
    */
    if (!mine) {
      /*
        CHẶNG CỦA KHÁCH KHÁC ĐÃ KẾT THÚC TRƯỚC NGÀY TREO Ở ĐÂY ⇒ IM LẶNG.

        Đó là LẦN LẮP TRƯỚC ở một điểm đo khác, hoàn toàn bình thường — công tơ
        tháo ở chỗ này rồi lắp sang chỗ kia là chuyện hằng ngày. Ca thật:
        `2510203116` chạy cho GIZA (KCNTTI-002) tới 10/02/2026, rồi treo sang
        `TTI.TITAN.NX5.1000kVA` của TITAN (KCNTTI-007) ngày 09/05/2026. Điểm đo
        mới chưa phát sinh hóa đơn nên không có chặng nào mang tên TITAN, và
        bản cũ kêu "có hóa đơn nhưng của khách khác" — đúng sự thật nhưng không
        phải lỗi, mà lại làm chìm những ca gõ nhầm số thật.

        Chỉ nhắc khi chặng của khách khác GIAO với quãng treo đang khai: lúc đó
        cùng một công tơ mới thật sự bị hai nơi cùng nhận.
      */
      const on = ymdOf(r.dateOn);
      const off = ymdOf(r.dateOff) || '9999-12-31';
      const clash = on ? segs.filter(x => x.from <= off && on <= x.to) : segs;

      if (clash.length) {
        // Có hóa đơn mang tên khách khác TRONG chính quãng treo ⇒ nhiều khả
        // năng gõ nhầm số chế tạo.
        invoiceNotes.push(`công tơ ${serial} có hóa đơn nhưng KHÔNG có chặng nào của ${pointMkh} `
          + `(${clash.map(x => `${x.mkh}: ${dmyRange(x.from, x.to)}`).join(', ')})`);
      } else if (segs.length && isHung(r)) {
        // Lần lắp trước ở nơi khác — nói cho biết, không phải cảnh báo.
        const last = segs[segs.length - 1];
        invoiceNotes.push(`công tơ ${serial} trước đây chạy cho ${last.mkh} `
          + `(${dmyRange(last.from, last.to)}) — lần lắp ở đây chưa phát sinh hóa đơn`);
      } else if (isHung(r)) {
        // Chưa có hóa đơn nào. Nói đúng bản chất — "chưa phát sinh", không phải
        // "không có" — vì công tơ vừa treo thì đương nhiên chưa có.
        const current = mkhMeters.filter(m => m.isCurrent).map(m => m.serial);
        const list = (current.length ? current : mkhMeters.slice(0, 4).map(m => m.serial)).join(', ');
        invoiceNotes.push(
          `số công tơ ${serial} chưa phát sinh hóa đơn của ${pointMkh}`
          + (list ? ` — khách này đang phát sinh trên ${list}` : ''));
      }
      continue;
    }

    // Có chặng của đúng khách này, nhưng ngày khai không giao với nó. Đây là
    // LỖI NGÀY, không phải lỗi khách — nói nhầm thành "của khách khác" thì người
    // dùng đi kiểm tra sai chỗ.
    if (isHung(r) && !inWindow) {
      invoiceNotes.push(
        `công tơ ${serial} có hóa đơn của ${pointMkh} ở quãng ${dmyRange(mine.from, mine.to)}, `
        + `không giao với ngày treo/tháo đang khai (${dmyRange(r.dateOn, r.dateOff)}) `
        + '— kiểm tra lại hai ngày này');
    }

    // Cùng số công tơ nhưng có chặng của khách khác ⇒ vật tư dùng lại, nói cho
    // biết để không nhầm HSN của quãng này với quãng kia.
    const others = segs.filter(x => x.mkh !== pointMkh);
    if (others.length) {
      invoiceNotes.push(`công tơ ${serial} còn được dùng cho `
        + `${others.map(x => `${x.mkh} (${dmyRange(x.from, x.to)})`).join(', ')}`);
    }
    if (r.dateOn && r.dateOn > mine.from) {
      invoiceNotes.push(`công tơ ${serial} khai treo ${dmy(r.dateOn)} nhưng đã phát sinh tiền điện từ ${dmy(mine.from)}`);
    }
    if (r.dateOff && r.dateOff < mine.to) {
      invoiceNotes.push(`công tơ ${serial} khai tháo ${dmy(r.dateOff)} nhưng còn phát sinh tiền điện đến ${dmy(mine.to)}`);
    }
    if (mine.hsnHistory.length > 1) {
      invoiceNotes.push(`công tơ ${serial} từng đổi HSN: ${mine.hsnHistory.join(' → ')}`);
    }
  }

  /**
   * HSN phải khớp hóa đơn — áp cho MỌI điểm đo, kể cả đã ngưng hoạt động
   * (user chốt 20/08). Điểm đo tháo rồi mà HSN sai thì sản lượng lịch sử vẫn sai.
   * Lấy HSN của hóa đơn theo công tơ đang hoạt động; không có thì lấy công tơ
   * cuối cùng từng gắn.
   */
  const refHsn = invoiceHsn
    ?? meterRefs.map(m => m.mine?.hsn).filter((h): h is number => h != null).pop();
  /**
   * HSN thực sự ghi xuống = HSN NHẬP TAY ở ô HSN (user chốt 28/09/2026 — plan
   * `2026-09-28-diem-do-chon-vat-tu-tu-kho-theo-hsn`). Trước đây suy từ TI/TU
   * rồi lùi về hóa đơn; nay hai con số đó chỉ còn là THAM CHIẾU hiện dưới ô,
   * còn bộ TI/TU phải chọn cho khớp HSN chứ không phải ngược lại.
   */
  const manualHsn = parseHsnInput(pForm.hsn);
  const effectiveHsn = manualHsn;

  if (refHsn != null && derivedHsn != null && derivedHsn !== refHsn) {
    invoiceNotes.push(tuRow
      ? `TI × TU đang ra HSN ${derivedHsn}, hóa đơn ghi ${refHsn} — tích hai tỷ số phải bằng ${refHsn}`
      : `HSN khai ra ${derivedHsn} nhưng hóa đơn ghi ${refHsn} — kiểm tra lại tỷ số TI`);
  }
  if (refHsn != null && manualHsn != null && manualHsn !== refHsn) {
    invoiceNotes.push(`HSN nhập ${manualHsn} nhưng hóa đơn ghi ${refHsn} — kiểm tra lại HSN của điểm đo`);
  }

  /* ---------------- Trùng số chế tạo (số No) ---------------- */
  /**
   * Hai loại đụng độ, đều CHẶN LƯU (khác với các cảnh báo mềm khác của màn này):
   *
   * 1. Trùng ngay trong bảng vật tư của điểm đo đang khai — PocketBase cũng
   *    chặn (unique `serial` + `point`), báo trước cho rõ ràng thay vì để PB
   *    trả lỗi khó hiểu lúc bấm Lưu.
   * 2. Số đó đang CÒN HOẠT ĐỘNG ở điểm đo khác — một công tơ không thể đang đo
   *    ở hai nơi cùng lúc. Muốn lắp sang đây thì phải cho ngưng ở điểm đo cũ
   *    trước (user chốt 20/08/2026).
   */
  const serialInForm = new Map<string, AssetRow[]>();
  for (const r of pForm.assetRows) {
    const s = r.serial.trim();
    if (!s) continue;
    serialInForm.set(s, [...(serialInForm.get(s) ?? []), r]);
  }
  const dupInForm = [...serialInForm.entries()].filter(([, rows]) => rows.length > 1);


  /** Số No của dòng MỚI phải nằm trong kho — chốt chặn phòng khi ô chọn bị lách. */
  const notInStock = pForm.assetRows.filter(r => !r.id && r.serial.trim() && !deviceOf(r.serial));
  /** Chốt chặn: dòng mới đã có ngày treo mà thiết bị còn treo ở điểm đo khác. */
  const datedWhileHung = pForm.assetRows.filter(r => !r.id && r.dateOn.trim() && (d?.assets ?? []).some(a =>
    a.serial === r.serial.trim() && a.active && a.point && a.point !== editingId && a.date_on));

  /**
   * Cùng số chế tạo mà HAI NƠI CÙNG ĐANG TREO — chỉ thế mới chặn.
   *
   * Khai một vật tư vào điểm đo CŨ trong khi nó đang chạy ở nơi khác là hợp lệ:
   * đó là ghi lại lần lắp trước đó. Luật (4) trong `applyRowRules` đã tự điền
   * ngày tháo ở đây = ngày treo bên kia, nên dòng này không còn "đang treo" và
   * không có gì phải chặn (user chốt 25/08/2026).
   */
  /**
   * Điểm đo đó còn HOÀN TOÀN DỰ KIẾN hay không: không vật tư nào của nó có
   * ngày treo.
   *
   * Ngày treo là mốc duy nhất chứng minh vật tư đã ra hiện trường, nên chưa
   * dòng nào có ngày treo tức là cả điểm đo mới nằm trên giấy.
   */
  const isPlannedPoint = (pointId?: string) => {
    if (!pointId) return false;
    const rows = (d?.assets ?? []).filter(a => a.point === pointId);
    return rows.length > 0 && !rows.some(a => (a.date_on ?? '').trim());
  };

  /** Điểm đo ĐANG KHAI còn dự kiến: không dòng nào trên form có ngày treo. */
  const thisPlanned = hungRows.length === 0;

  const serialConflicts = [...serialInForm.entries()]
    .map(([serial, rows]) => {
      // Ở form này số No đó còn đang treo (chưa khai ngày tháo) hay không.
      if (!rows.some(r => !r.dateOff.trim())) return null;
      const other = (d?.assets ?? []).find(a =>
        a.serial === serial && a.active && a.point && a.point !== editingId);
      if (!other) return null;
      // Dòng MỚI giữ thiết bị đang treo nơi khác ở dạng DỰ KIẾN (chưa ngày treo)
      // là hợp lệ từ 28/09/2026 — ngày treo đã bị khoá, không phải đụng độ.
      if (other.date_on && rows.every(r => !r.id && !r.dateOn.trim())) return null;
      return { serial, asset: other, code: pointCodeOf(other.point) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  /**
   * HAI ĐIỂM ĐO CÙNG DỰ KIẾN thì ĐỔI CHỖ số No cho nhau (user chốt 28/08/2026,
   * sửa lại chiều tối cùng ngày: đổi chỗ chứ không xoá bên kia).
   *
   * Vật tư dự kiến mới là dự định phân bổ, chưa có gì ngoài hiện trường. Tình
   * huống thật gần như luôn là GÁN NHẦM CHÉO: định cho A số S2 và cho B số S1,
   * nhưng lỡ gõ ngược. Người dùng vào A sửa thành S2 — thứ họ muốn là B nhận
   * lại S1, chứ không phải B mất trắng vật tư.
   *
   * Vì vậy lấy SỐ CŨ CỦA CHÍNH DÒNG ĐANG SỬA làm vế đối ứng. Không có số cũ
   * (dòng vừa thêm mới) thì không có gì để đổi — lúc đó là CHUYỂN, bên kia mất
   * dòng đó; câu nhắc nói rõ hai trường hợp khác nhau.
   *
   * Điều kiện vẫn NGẶT: cả hai điểm đo đều chưa vật tư nào được treo. Chỉ cần
   * một bên đã lắp thật thì chặn như cũ, vì số No lúc đó chỉ một thiết bị có
   * thật ngoài lưới.
   */
  /*
    NỚI 13/10/2026 (user chốt): chỉ cần DÒNG VẬT TƯ bên kia còn DỰ KIẾN (chưa
    ngày treo) là CHUYỂN được về đây — bên kia gỡ dòng đó khi lưu — dù điểm đo
    bên kia hay điểm đo này đã vận hành. Vật tư dự kiến chỉ là dự định phân bổ,
    bắt người dùng sang điểm đo kia xoá trước là thừa một vòng.
    ĐỔI CHỖ vẫn giữ điều kiện NGẶT cũ (cả hai điểm đo cùng dự kiến): đưa số cũ
    của một điểm đo đang chạy sang bên kia là đẩy một thiết bị có thật đi.
    Bên kia đã TREO THẬT (có ngày treo) thì vẫn chặn như cũ.
  */
  const reclaim = serialConflicts
    .filter(b => !(b.asset.date_on ?? '').trim())
    .map(b => {
      // Dòng trên form đang mang số No này, và số No nó giữ TRƯỚC khi sửa.
      const row = pForm.assetRows.find(r => r.serial.trim() === b.serial);
      const saved = row?.id ? (d?.assets ?? []).find(a => a.id === row.id) : undefined;
      const swapTo = (saved?.serial ?? '').trim();
      // Chỉ đổi chỗ khi số cũ thật sự khác và không đang nằm ở đâu khác.
      const canSwap = thisPlanned && isPlannedPoint(b.asset.point)
        && !!swapTo && swapTo !== b.serial
        && !(d?.assets ?? []).some(a => a.serial.trim() === swapTo && a.id !== saved?.id && a.point);
      return { ...b, swapTo: canSwap ? swapTo : '' };
    });
  const busyElsewhere = serialConflicts.filter(b => !reclaim.some(r => r.serial === b.serial));

  /**
   * Mã điểm đo trùng một điểm đo khác. `dm_point.code` là UNIQUE nên PocketBase
   * sẽ trả "Value must be unique" — một câu chẳng nói được gì. Bắt trước ở đây
   * và nói rõ đang đụng vào điểm đo nào.
   *
   * Rất dễ gặp: điểm đo chính cùng khách với chủ trạm sinh mã ĐÚNG BẰNG mã
   * trạm, nên khai điểm đo chính thứ hai cho cùng một trạm là trùng ngay.
   */
  const codeClash = pointCode && !pointCodeMissing.length
    ? d?.points.find(p => p.code === pointCode && p.id !== editingId)
    : undefined;

  const serialBlocks: string[] = [
    ...(notInStock.length ? [
      `số No ${notInStock.map(r => r.serial.trim()).join(', ')} chưa có trong Kho vật tư `
      + '— khai thiết bị ở tab Kho vật tư trước rồi chọn lại',
    ] : []),
    ...(datedWhileHung.length ? [
      `số No ${datedWhileHung.map(r => r.serial.trim()).join(', ')} còn đang treo ở điểm đo khác `
      + '— khai ngày tháo ở điểm đo cũ trước rồi mới khai ngày treo ở đây',
    ] : []),
    ...dupInForm.map(([serial, rows]) =>
      `số No ${serial} bị khai ${rows.length} lần trong cùng điểm đo `
      + `(${rows.map(r => ASSET_LABEL[r.type as AssetType] ?? '—').join(', ')})`),
    ...busyElsewhere.map(b =>
      `số No ${b.serial} đang treo ở ${ASSET_LABEL[b.asset.type as AssetType] ?? 'vật tư'} `
      + `của điểm đo ${b.code} — khai NGÀY THÁO cho nó ở điểm đo đó, `
      + 'hoặc khai ngày tháo ngay tại dòng này nếu đây là lần lắp trước đó'),
    ...(codeClash ? [
      `mã điểm đo ${pointCode} đã thuộc về một điểm đo khác `
      + `(khách ${customerMkh(codeClash.customer)}) — đổi định danh điểm đo, `
      + 'hoặc chọn khách hàng khác để mã có đuôi phân biệt',
    ] : []),
  ];

  /**
   * TỶ SỐ TI / TU LÀ BẮT BUỘC — CHẶN LƯU (user chốt 27/08/2026).
   *
   * HSN = (TI sơ/thứ) × (TU sơ/thứ), và HSN nhân thẳng vào chỉ số đọc từ HES:
   * thiếu tỷ số thì điểm đo lưu xuống với HSN rỗng, mọi sản lượng tính từ nó
   * đều sai. Trước đây chỉ NHẮC, nên đã có điểm đo lọt xuống PB không HSN.
   *
   * Áp cho CẢ dòng dự kiến: điểm đo dự kiến nay cũng suy HSN từ chính các dòng
   * đó, nên bỏ trống tỷ số là bỏ trống HSN.
   *
   * Dòng trắng hoàn toàn (chưa gõ số No, chưa gõ tỷ số) không tính — đó là dòng
   * người dùng vừa thêm ra chứ chưa khai gì.
   */
  const ratioRows = pForm.assetRows.filter(r =>
    HAS_RATIO.includes(r.type as AssetType) && (r.serial.trim() !== '' || r.ratio.trim() !== ''));
  const missingRatioRows = ratioRows.filter(r => r.ratio.trim() === '');
  const badRatioRows = ratioRows.filter(r => {
    if (!r.ratio.trim()) return false;
    const { primary, secondary } = parseRatio(r.ratio);
    return primary === 0 || secondary === 0 || primary == null || secondary == null;
  });

  const ratioBlocks: string[] = [
    ...(missingRatioRows.length ? [
      `chưa nhập tỷ số cho ${missingRatioRows.length} `
      + `${missingRatioRows.map(r => `${r.type} ${r.serial.trim() || '—'}`).join(', ')} `
      + '— không có tỷ số thì không suy được HSN, mà HSN sai là sản lượng sai',
    ] : []),
    ...(badRatioRows.length ? [
      `tỷ số không hợp lệ ở ${badRatioRows.length} dòng `
      + `(${badRatioRows.map(r => `${r.type} ${r.serial.trim() || '—'}: "${r.ratio}"`).join(', ')})`
      + ' — sơ cấp và thứ cấp đều phải khác 0, dạng 200/5',
    ] : []),
    // Có TI mà công thức vẫn không ra số: tỷ số gõ dở kiểu "200/" chẳng hạn.
    ...(hasTi && derivedHsn == null ? [
      'chưa suy được HSN từ tỷ số đang khai — kiểm tra lại ô tỷ số của TI / TU',
    ] : []),
  ];

  /** HSN là ô bắt buộc — thiếu hoặc gõ sai thì không có gì để nhân sản lượng. */
  const hsnBlocks: string[] = !pForm.hsn.trim()
    ? ['chưa nhập HSN của điểm đo']
    : manualHsn == null
      ? [`HSN "${pForm.hsn.trim()}" không hợp lệ — phải là số lớn hơn 0 (1 = đo thẳng)`]
      : [];

  /**
   * BỘ TI × TU PHẢI KHỚP HSN NHẬP TAY — CHẶN LƯU (user chốt 28/09/2026).
   *
   * Xét đúng bộ dòng đang dùng để suy HSN (`hsnRows`: vật tư đã treo, hoặc
   * vật tư dự kiến khi cả điểm đo còn dự kiến). Điểm đo cũ đang lệch sẵn chỉ
   * bị chặn khi người dùng sửa HSN hoặc vật tư (`pSnap`).
   */
  const hsnTouched = hsnSig(pForm.hsn, pForm.assetRows) !== pSnap;
  /*
    Dòng thêm từ bộ gợi ý mang sẵn tỷ số (`want`) nhưng chưa chọn Số No: hàm lưu
    BỎ QUA dòng không có số No, trong khi tỷ số của nó vẫn góp vào phép so HSN
    bên dưới — không chặn thì khớp HSN trên form mà xuống PB lại thiếu bộ TI.
  */
  const unpicked = pForm.assetRows.filter(r => !r.id && r.want && !r.serial.trim());
  if (unpicked.length) {
    hsnBlocks.push(`chưa chọn Số No cho ${unpicked.length} dòng `
      + `${[...new Set(unpicked.map(r => `${r.type} ${r.want}`))].join(', ')} — chọn từ Kho hoặc bỏ dòng`);
  }
  const tiSet = hasTi ? ratioOfSet('TI') : null;
  const tuSet = ratioOfSet('TU');
  /*
    CHƯA KHAI TI NÀO mà HSN > 1 ⇒ CHO LƯU (user chốt 28/09/2026: điền HSN
    trước, TI bổ sung sau). Chỉ nhắc ở `assetWarnings`. Đã có TI thì bộ TI phải
    khớp HSN như cũ; HSN = 1 mà có TI vẫn chặn.
  */
  const tiLater = manualHsn != null && manualHsn > 1 && !hasTi;
  const hsnMismatch = manualHsn != null && hsnTouched && !ratioBlocks.length && !tiLater
    && !setMatchesHsn(manualHsn, tiSet, tuSet);
  if (hsnMismatch) {
    hsnBlocks.push(manualHsn === 1
      ? 'HSN = 1 (đo thẳng) nhưng điểm đo đang có TI — bỏ TI hoặc sửa HSN'
      : !hasTi
        ? `HSN ${manualHsn} cần bộ TI (× TU) có tích tỷ số bằng ${manualHsn} — chọn bộ ở mục gợi ý`
        : `bộ vật tư đang ra ${hsnFormula(hsnInput).replace(/^.*→ /, '')}, `
          + `không khớp HSN nhập ${manualHsn} — chọn bộ TI/TU khác hoặc sửa HSN`);
  }

  /**
   * Gợi ý bộ TI (× TU) còn rảnh trong kho có tích tỷ số = HSN. Số No đã có
   * trong form không tính là rảnh.
   */
  const setSuggestions = manualHsn != null && manualHsn > 1
    ? suggestSets(manualHsn, freeDevices(d?.devices ?? [], d?.assets ?? [], {
        pointId: editingId, exclude: pForm.assetRows.map(r => r.serial),
      // Trước mắt CHỈ bộ TI (user chốt 28/09/2026) — bỏ các tổ hợp có TU.
      })).filter(s => !s.tu)
    : [];

  /**
   * Dòng NHU CẦU chưa treo (đã lưu, chưa ngày treo) thuộc Nhóm Vật Tư — form này là
   * phần TREO THÁO: không đổi loại/số No, không xoá, chỉ khai ngày treo để treo nó
   * (điểm đo hai phần, user chốt 27/10/2026).
   */
  const isNeedRow = (r: AssetRow) => !!r.id
    && !((d?.assets ?? []).find(a => a.id === r.id)?.date_on ?? '').slice(0, 10);
  /**
   * Phần TREO THÁO bắt buộc ngày treo (user chốt 27/10/2026): dòng thêm mới, và dòng
   * đã treo bị xoá ngày treo, đều chặn — dòng chưa ngày treo chỉ thuộc phần nhu cầu.
   */
  const treoBlocks = pForm.assetRows
    .filter(r => !isNeedRow(r) && r.serial.trim() && !r.dateOn.trim())
    .map(r => `${r.serial.trim()}: phần treo tháo phải có ngày treo `
      + `(gắn số No dự kiến là việc của Nhóm Vật Tư ở màn Gắn vật tư dự kiến)`);
  /** Bảng TREO THÁO chỉ hiện dòng có ngày treo / dòng mới; dòng dự kiến hiện ở phần nhu cầu. */
  const treoRows = pForm.assetRows.filter(r => !isNeedRow(r));
  const needRows = pForm.assetRows.filter(isNeedRow);

  /**
   * TRẦN vật tư hoạt động (user chốt 12/11/2026): tối đa 1 GP-03, 1 công tơ, 3 TI
   * đang treo. Treo bổ sung vượt trần thì phải khai ngày tháo cho cái tương ứng — chặn lưu.
   */
  const capBlocks = overCap(pForm.assetRows
    .filter(r => r.serial.trim() && r.active && r.dateOn.trim() && !r.dateOff.trim())
    .map(r => r.type))
    .map(x => `${ASSET_LABEL[x.type]} đang treo ${x.have}, tối đa ${x.cap} — `
      + `treo bổ sung thì khai ngày tháo cho ${x.have - x.cap} cái cũ`);

  /** Mọi thứ CHẶN lưu điểm đo: HSN + đụng độ số chế tạo + thiếu/sai tỷ số + dòng mới thiếu ngày treo + vượt trần. */
  const saveBlocks = [...hsnBlocks, ...serialBlocks, ...ratioBlocks, ...treoBlocks, ...capBlocks];

  /**
   * Cảnh báo vật tư — CHỈ nhắc, không chặn lưu (user chốt 14/08). Điểm đo đang
   * khai dở vẫn phải lưu được.
   */
  const filledRows = pForm.assetRows.filter(r => r.type && r.serial.trim());
  /**
   * Chỉ đếm thiết bị ĐÃ TREO và đang hoạt động — cái đã tháo vẫn nằm bảng để
   * giữ lịch sử, còn dòng chưa có ngày treo là vật tư DỰ KIẾN, chưa ra hiện
   * trường nên không được tính vào bất cứ điều kiện nào.
   */
  const countType = (t: AssetType) =>
    filledRows.filter(r => r.type === t && r.active && isHung(r)).length;

  /** Các dòng dự kiến — khai rồi nhưng chưa có ngày treo. */
  const plannedRows = filledRows.filter(r => !isHung(r));
  const assetWarnings: string[] = [];
  if (tiLater) {
    assetWarnings.push(`HSN ${manualHsn} là đo gián tiếp nhưng chưa khai TI — lưu được, `
      + 'nhớ bổ sung bộ TI khớp HSN sau');
  }
  // Nhiều hơn 1 công tơ đang treo nay là LỖI chặn lưu (`capBlocks`, trần vật tư 12/11/2026).
  if (countType('CONGTO') === 0) assetWarnings.push('chưa có công tơ đang hoạt động');
  // Không nhắc "thiếu GP-03" nữa: user bỏ ràng buộc bắt buộc có đo xa (20/08/2026).

  // Lệch tỷ số trong cùng một bộ TI (hoặc TU): 3 TI phải cùng tỷ số, khác nhau
  // là khai nhầm — HSN đang lấy theo dòng đầu nên phải nói rõ.
  for (const t of HAS_RATIO) {
    const kinds = new Set(
      pForm.assetRows.filter(r => r.active && isHung(r) && r.type === t && r.ratio.trim())
        .map(r => r.ratio.trim()));
    if (kinds.size > 1) {
      assetWarnings.push(`các ${t} không cùng tỷ số (${[...kinds].join(' ≠ ')}) — HSN đang lấy theo cái đầu`);
    }
  }

  // Hai cảnh báo "ngưng mà chưa khai ngày tháo" / "còn chạy mà đã có ngày tháo"
  // đã bỏ (25/08/2026): `active` nay SUY TỪ ngày tháo nên không thể mâu thuẫn.
  if (filledRows.some(r => r.dateOn && r.dateOff && r.dateOff < r.dateOn)) {
    assetWarnings.push('có thiết bị khai ngày tháo trước ngày treo');
  }
  // Có TI = đo gián tiếp ⇒ phải đủ bộ 3. Không có TI = đo thẳng, HSN = 1.
  if (hasTi && countType('TI') > 0 && countType('TI') < TI_PER_SET) {
    assetWarnings.push(`đo gián tiếp phải đủ ${TI_PER_SET} TI (đang có ${countType('TI')} cái hoạt động)`);
  }
  /*
    Số No lấy từ KHO — nói rõ để người dùng biết nó không phải thiết bị mới, và
    biết mình có đang lấy nhầm cái đang dành cho nơi khác không.

    Chỉ nhắc khi thiết bị đang RẢNH (chưa treo ở đâu); còn đang treo nơi khác
    thì đã có `busyElsewhere` / `reclaim` lo, nói thêm chỉ nhiễu.
  */
  for (const r of pForm.assetRows) {
    const dev = deviceOf(r.serial);
    if (!dev) continue;
    const live = (d?.assets ?? []).some(a =>
      a.serial.trim() === r.serial.trim() && a.date_on && !a.date_off && a.point !== editingId);
    if (live) continue;
    const holdFor = dev.hold_point && dev.hold_point !== editingId
      ? pointCodeOf(dev.hold_point)
      : [customerMkh(dev.hold_for_customer), dev.hold_for_note].filter(x => x && x !== '—').join(' · ');
    assetWarnings.push(`số No ${r.serial.trim()} lấy từ kho`
      + (holdFor ? ` — đang dành cho ${holdFor}` : ''));
  }

  /*
    Nói TRƯỚC khi lưu rằng số No sẽ bị gỡ khỏi điểm đo kia. Đây là thao tác
    XOÁ dữ liệu ở một bản ghi người dùng không mở ra — im lặng làm là không
    được, dù cả hai bên đều mới chỉ là dự kiến.
  */
  for (const b of reclaim) {
    assetWarnings.push(b.swapTo
      // Đổi chỗ: nói rõ bên kia nhận lại số nào, kẻo tưởng họ mất vật tư.
      ? `số No ${b.serial} đang được ${b.code} giữ chỗ — khi lưu sẽ ĐỔI CHỖ: `
        + `${b.serial} về đây, còn ${b.code} nhận ${b.swapTo}`
      : `số No ${b.serial} đang được ${b.code} giữ chỗ — khi lưu sẽ CHUYỂN về đây `
        + `và ${b.code} mất dòng đó (dòng này chưa có số No cũ nào để đổi lại)`);
  }

  if (plannedRows.length) {
    assetWarnings.push(hsnFromPlan
      // Cả bộ còn dự kiến ⇒ HSN đang lấy từ chính mấy dòng này.
      ? `${plannedRows.length} dòng chưa khai ngày treo — điểm đo còn DỰ KIẾN, `
        + 'HSN đang suy từ tỷ số dự kiến và sẽ tính lại theo vật tư thực khi khai ngày treo'
      : `${plannedRows.length} dòng chưa khai ngày treo — đang coi là VẬT TƯ DỰ KIẾN, `
        + 'không tính vào HSN và không đối chiếu hóa đơn');
  }

  /**
   * Trạng thái điểm đo do hệ thống suy, không cho chọn tay nữa (user chốt
   * 20/08). Tính ngay trên form để người dùng thấy tag đổi theo lúc khai.
   */
  const assetCounts = countAssets(filledRows);
  const derivedStatus = derivePointStatus({
    ...assetCounts,
    // Dùng `inWindow`: chỉ chặng ĐÚNG quãng treo mới chứng minh điểm đo này
    // đang phát sinh tiền điện — chặng ở quãng khác là của lần lắp khác.
    hasRecentInvoice: meterRefs.some(m => m.row.active && m.inWindow?.isCurrent),
    isHead,
  });

  /**
   * Vì sao đang là trạng thái đó — nói ngay dưới tag, vì "Dự kiến" trong khi đã
   * khai đủ vật tư trông như lỗi nếu không nói rõ còn thiếu ngày treo.
   */
  /**
   * Đang vận hành mà thiếu GP-03 hoặc SIM ⇒ mất đo xa, phải đọc chỉ số bằng tay.
   * Đặt SAU `derivedStatus` vì luật chỉ áp cho điểm đo đang vận hành.
   */
  const remoteMissing = derivedStatus === 'active' ? missingRemote(filledRows) : [];
  if (remoteMissing.length) {
    assetWarnings.push(
      `điểm đo đang vận hành nhưng thiếu ${remoteMissing.map(t => REMOTE_LABEL[t]).join(' và ')} `
      + '— không đẩy được chỉ số về HES, phải đọc tay');
  }

  const statusReason =
    derivedStatus !== 'du_kien' ? ''
      : assetCounts.meters === 0 ? 'Chưa khai công tơ nào.'
      : assetCounts.metersWithoutDateOn > 0
        ? `Còn ${assetCounts.metersWithoutDateOn} công tơ đang hoạt động chưa khai ngày treo.`
        : '';

  return {
    pStation, pStationZone, pStationCustomer, pSubCustomer, isSub, isHead, pLine, lineHeadTaken, allLineOpts, pParent, parentCustomerId, sameCustomer, purposeLabel, mainTenant, subLabel, pointParts, generatedCode, pointCodeMissing, savedPoint, codeLocked, lockedCode, pointCode, isHung, hungRows, hsnRows, hsnFromPlan, ratioRowOf, ratioOfSet, hasTi, hsnInput, derivedHsn, activeMeter, activeSegs, activeSeg, invoiceHsn, tuRow, tiSecondary, canFillTi, suggestedTi, meterRefs, mkhMeters, invoiceNotes, refHsn, manualHsn, effectiveHsn, serialInForm, dupInForm, notInStock, datedWhileHung, isPlannedPoint, thisPlanned, serialConflicts, reclaim, busyElsewhere, codeClash, serialBlocks, ratioRows, missingRatioRows, badRatioRows, ratioBlocks, hsnBlocks, hsnTouched, unpicked, tiSet, tuSet, tiLater, hsnMismatch, setSuggestions, isNeedRow, treoBlocks, treoRows, needRows, capBlocks, saveBlocks, filledRows, countType, plannedRows, assetWarnings, assetCounts, derivedStatus, remoteMissing, statusReason,
  };
}

export type PointCheck = ReturnType<typeof checkPointForm>;
