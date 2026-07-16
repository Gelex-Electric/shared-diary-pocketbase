/**
 * Reader cho thông số kỹ thuật máy biến áp (Sdm/P0/PK) — trước đây đọc /mba_info.csv
 * (sửa tay), nay đọc/ghi collection PocketBase `mba_info` (Task 3, nhập qua UI).
 *
 * PocketBase KHÔNG lưu NULL cho field number (JSON null bị ép về 0) — nên "chưa nhập"
 * được xác định bằng NGƯỠNG <=0 (P0/PK/Sdm vật lý luôn phải dương), không phải kiểm
 * tra rỗng/null. Đơn vị lưu trong PB: Sdm(kVA), P0/PK theo WATT (giữ nguyên như nhãn
 * máy biến áp thực tế) — convert sang kW khi đọc, giống quy ước CSV cũ.
 *
 * Quyền sửa theo KCN: mba_info.updateRule/createRule so khớp field `zone` với
 * @request.auth.area2 (area2='' = GETC/admin sửa tất cả).
 */
import { fetchAll } from './pbData';
import { pb } from './pocketbase';

export interface MbaParams {
  _id: string;    // record id trong PB (để sửa)
  code: string;   // TBA gốc
  zone: string;   // mã KCN (KCNTH/KCNYM/...) — dùng kiểm tra quyền sửa
  sdm: number;    // kVA
  p0: number;     // kW (đã ÷1000 từ W)
  pk: number;     // kW
  hasParams: boolean; // có đủ P0 & PK (>0) để tính tổn thất
}

interface MbaInfoRec {
  id?: string; code?: string; zone?: string;
  sdm_kva?: number; p0_w?: number; pk_w?: number;
}

/** Chuẩn hoá mã trạm để so khớp: viết hoa, bỏ mọi khoảng trắng. */
export function normCode(s: string): string {
  return (s || '').toUpperCase().replace(/\s+/g, '').trim();
}

function mapRec(r: MbaInfoRec): MbaParams {
  const p0w = r.p0_w ?? 0;
  const pkw = r.pk_w ?? 0;
  return {
    _id: r.id ?? '',
    code: r.code ?? '',
    zone: r.zone ?? '',
    sdm: r.sdm_kva ?? 0,
    p0: p0w / 1000,
    pk: pkw / 1000,
    hasParams: p0w > 0 && pkw > 0 && (r.sdm_kva ?? 0) > 0,
  };
}

export async function fetchMbaInfo(): Promise<MbaParams[]> {
  const recs = await fetchAll<MbaInfoRec>('mba_info');
  return recs.map(mapRec);
}

/**
 * Cập nhật thông số MBA (Sdm/P0/PK, đơn vị Sdm=kVA, P0/PK=WATT như nhãn máy).
 * `id` = MbaParams._id. PB kiểm quyền theo updateRule (KCN của tài khoản) → ném lỗi
 * nếu không đủ quyền.
 */
export async function updateMbaParams(
  id: string, sdmKva: number, p0W: number, pkW: number,
): Promise<void> {
  await pb.collection('mba_info').update(id, { sdm_kva: sdmKva, p0_w: p0W, pk_w: pkW });
}

/** True nếu tài khoản hiện tại được phép sửa thông số MBA của trạm có `zone` này. */
export function canEditMba(zone: string): boolean {
  const area2 = (pb.authStore.model as { area2?: string } | null)?.area2 ?? '';
  if (!pb.authStore.isValid) return false;
  if (area2 === '') return true;      // GETC/admin: sửa tất cả
  return zone === area2;              // chỉ KCN của tài khoản
}

/**
 * Dựng bộ tra cứu params theo CODE của trạm.
 * Khớp chính xác (chuẩn hoá) trước, nếu không có thì khớp theo TBA là tiền tố dài nhất của CODE.
 */
export function buildMbaLookup(list: MbaParams[]): (code: string) => MbaParams | undefined {
  const exact = new Map<string, MbaParams>();
  const normed: { key: string; p: MbaParams }[] = [];
  for (const p of list) {
    const k = normCode(p.code);
    if (!exact.has(k)) exact.set(k, p);
    normed.push({ key: k, p });
  }
  // ưu tiên tiền tố dài nhất để tránh khớp nhầm trạm khác
  normed.sort((a, b) => b.key.length - a.key.length);
  return (code: string) => {
    const k = normCode(code);
    if (!k) return undefined;
    const e = exact.get(k);
    if (e) return e;
    return normed.find(({ key }) => k.startsWith(key) || key.startsWith(k))?.p;
  };
}
