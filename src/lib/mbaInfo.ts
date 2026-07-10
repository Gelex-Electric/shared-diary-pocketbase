/**
 * Reader cho public/mba_info.csv — thông số kỹ thuật máy biến áp do người dùng nhập tay
 * (pipeline chỉ tự thêm dòng TBA mới, để trống Sdm/P0/PK).
 *
 * Định dạng: phân tách bằng dấu `;`, số kiểu vi-VN (dấu phẩy thập phân), đơn vị W cho P0/PK.
 *   TBA ; Sdm(kVA) ; DEP0(W) ; DEPK(W)
 *
 * TBA khớp với CODE của trạm (line_info.csv / metterinfo.csv) theo kiểu tiền tố sau khi
 * chuẩn hoá (bỏ khoảng trắng, viết hoa). Trạm không có đủ P0 & PK => không tính tổn thất.
 */

export interface MbaParams {
  code: string;   // TBA gốc
  sdm: number;    // kVA
  p0: number;     // kW (đã ÷1000 từ W)
  pk: number;     // kW
  hasParams: boolean; // có đủ P0 & PK để tính tổn thất
}

/** Chuẩn hoá mã trạm để so khớp: viết hoa, bỏ mọi khoảng trắng. */
export function normCode(s: string): string {
  return (s || '').toUpperCase().replace(/\s+/g, '').trim();
}

/** Parse số vi-VN: "5450,3" -> 5450.3; ô trống -> NaN. */
function viNum(v: string | undefined): number {
  const t = (v ?? '').trim().replace(/\./g, '').replace(',', '.');
  if (!t) return NaN;
  const n = parseFloat(t);
  return isNaN(n) ? NaN : n;
}

export async function fetchMbaInfo(): Promise<MbaParams[]> {
  const res = await fetch('/mba_info.csv', { cache: 'no-cache' });
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length <= 1) return [];
  const out: MbaParams[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    const code = (c[0] ?? '').trim();
    if (!code) continue;
    const sdm = viNum(c[1]);
    const p0w = viNum(c[2]);
    const pkw = viNum(c[3]);
    const hasParams = !isNaN(p0w) && !isNaN(pkw);
    out.push({
      code,
      sdm: isNaN(sdm) ? 0 : sdm,
      p0: isNaN(p0w) ? 0 : p0w / 1000,
      pk: isNaN(pkw) ? 0 : pkw / 1000,
      hasParams,
    });
  }
  return out;
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
