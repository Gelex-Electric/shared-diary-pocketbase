/**
 * Module QLVH — tầng dữ liệu (PocketBase).
 *
 * Luật nghiệp vụ nằm ở `qlvhRules.ts` (module thuần, chạy được bằng tsx).
 * File này chỉ lo đọc/ghi và ghép dữ liệu.
 *
 * Hai collection (tạo 21/08/2026 bằng `scripts/qlvh_migrate.mjs`):
 *   qlvh_contract  pbc_1503353560 — quan hệ tới dm_customer + dm_zone
 *   qlvh_payment   pbc_2848073591 — n đợt / hợp đồng, cascade delete
 */

import { pb } from './pocketbase';
import {
  dayOf, summarize,
  type ContractTotals, type PaymentLike,
} from './qlvhRules';

export * from './qlvhRules';

export const C_CONTRACT = 'qlvh_contract';
export const C_PAYMENT = 'qlvh_payment';
export const C_ITEM = 'qlvh_item';

/* ------------------------------------------------------------------ Kiểu */

export type ContractStatus = 'du_thao' | 'dang_hieu_luc' | 'tam_dung' | 'da_thanh_ly';

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  du_thao:       'Dự thảo (chưa ký)',
  dang_hieu_luc: 'Đang hiệu lực',
  tam_dung:      'Tạm dừng',
  da_thanh_ly:   'Đã thanh lý',
};

/**
 * Hợp đồng dự thảo KHÔNG tính vào công nợ và các ô số liệu — chưa ký thì chưa
 * có nghĩa vụ thu tiền. Vẫn hiện trong danh sách để giữ chỗ.
 */
export const isDraft = (c: { status_manual?: ContractStatus }) => c.status_manual === 'du_thao';

/** Nhãn màu cho trạng thái pháp lý — dùng lớp badge chung của app. */
const BADGE_BASE = 'inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded';

export const CONTRACT_STATUS_BADGE: Record<ContractStatus, string> = {
  du_thao:       `${BADGE_BASE} vl-badge-info`,
  dang_hieu_luc: `${BADGE_BASE} vl-badge-success`,
  tam_dung:      `${BADGE_BASE} vl-badge-warning`,
  da_thanh_ly:   `${BADGE_BASE} bg-subtle text-faint`,
};

/** 3 trạng thái dùng thật (bỏ 'tam_dung' theo yêu cầu user 21/08/2026). */
export const CONTRACT_STATUS_OPTIONS = (['du_thao', 'dang_hieu_luc', 'da_thanh_ly'] as ContractStatus[])
  .map(v => ({ value: v, label: CONTRACT_STATUS_LABEL[v] }));

/** Đổi riêng trạng thái pháp lý — sửa nhanh ngay trên thẻ, không mở hộp thoại. */
export async function updateContractStatus(id: string, status: ContractStatus): Promise<void> {
  await pb.collection(C_CONTRACT).update(id, { status_manual: status });
}

/** Bản ghi danh mục dùng lại — CHỈ ĐỌC, module này không sửa dm_*. */
export interface DmCustomer {
  id: string;
  mkh: string;
  name: string;
  short_name?: string;
  address?: string;
  zone?: string;
  active?: boolean;
}

export interface DmZone {
  id: string;
  code: string;
  name: string;
  active?: boolean;
}

export interface Contract {
  id: string;
  contract_no: string;
  /** id của dm_customer */
  customer: string;
  /** id của dm_zone */
  zone: string;
  sign_date: string;
  effective_from: string;
  effective_to: string;
  value_before_vat: number;
  vat_rate: number;
  value_vat: number;
  value_total: number;
  /** Tên khách chụp lại lúc nhập — dùng khi chưa có trong dm_customer. */
  customer_name?: string;
  che_xuat?: boolean;
  payment_terms?: string;
  status_manual: ContractStatus;
  note?: string;
  created?: string;
  updated?: string;
  expand?: {
    customer?: DmCustomer;
    zone?: DmZone;
  };
}

export interface Payment extends PaymentLike {
  id: string;
  contract: string;
  /** Ngày xuất hoá đơn — Điều 3.3 hợp đồng: hoá đơn phát hành SAU khi nhận được
   *  thanh toán, nên đây là mốc riêng, không trùng `paid_date`. */
  invoice_date?: string;
  invoice_no?: string;
  note?: string;
}

/**
 * Một dòng khối lượng & đơn giá — đúng "Phụ lục 01" của hợp đồng.
 * Đơn giá tính theo NĂM (ĐVT dạng `m/năm`, `máy/năm`).
 */
export interface ContractItem {
  id: string;
  contract: string;
  seq: number;
  content: string;
  unit: string;
  qty: number;
  unit_price: number;
  amount: number;
  note?: string;
}

export type ItemInput = Omit<ContractItem, 'id' | 'contract'>;

/** Tổng chi phí MỘT NĂM theo bảng khối lượng. */
export const yearlyTotal = (items: { qty: number; unit_price: number }[]) =>
  items.reduce((s, i) => s + Math.round((i.qty || 0) * (i.unit_price || 0)), 0);

/**
 * Giá trị hợp đồng trước thuế suy từ bảng khối lượng:
 *   tổng/năm × (thời hạn tính bằng tháng / 12)
 * Đúng cách Phụ lục 01 làm: 19.285.715 × 1,5 = 28.928.573 cho hợp đồng 18 tháng.
 */
export const valueFromItems = (
  items: { qty: number; unit_price: number }[],
  months: number,
) => Math.round((yearlyTotal(items) * (months || 12)) / 12);

/** Hợp đồng kèm lịch đợt và số liệu tổng hợp — thứ các màn hình thật sự dùng. */
export interface ContractWithSchedule {
  contract: Contract;
  payments: Payment[];
  totals: ContractTotals;
  customerName: string;
  /** Mã khách hàng (dm_customer.mkh) — khoá sắp xếp và nhãn hiển thị. */
  customerCode: string;
  zoneName: string;
  /** Mã KCN (dm_zone.code) — khoá tra màu, xem lib/kcnColors. */
  zoneCode: string;
}

/* ------------------------------------------------------------------- Đọc */

/** Danh mục khách hàng (dm_customer) để chọn trong form. Chỉ đọc. */
export async function fetchCustomers(): Promise<DmCustomer[]> {
  const items = await pb.collection('dm_customer').getFullList<DmCustomer>({
    sort: 'mkh',
    filter: 'active = true',
  });
  return items;
}

/** Danh mục KCN (dm_zone). Chỉ đọc. */
export async function fetchZones(): Promise<DmZone[]> {
  return pb.collection('dm_zone').getFullList<DmZone>({ sort: 'code' });
}

/**
 * Toàn bộ hợp đồng + lịch đợt.
 *
 * Nạp đợt bằng MỘT truy vấn cho tất cả hợp đồng rồi gom theo `contract`, thay vì
 * gọi lần lượt từng hợp đồng (n+1 truy vấn) — số hợp đồng sẽ tăng dần theo năm.
 */
export async function fetchContracts(zoneName?: string): Promise<ContractWithSchedule[]> {
  const contracts = await pb.collection(C_CONTRACT).getFullList<Contract>({
    sort: '-sign_date',
    expand: 'customer,zone',
  });

  const filtered = zoneName
    ? contracts.filter(c => c.expand?.zone?.name === zoneName)
    : contracts;
  if (filtered.length === 0) return [];

  const ids = new Set(filtered.map(c => c.id));
  const allPayments = await pb.collection(C_PAYMENT).getFullList<Payment>({ sort: 'seq' });

  const byContract = new Map<string, Payment[]>();
  for (const p of allPayments) {
    if (!ids.has(p.contract)) continue;
    const list = byContract.get(p.contract) || [];
    list.push(p);
    byContract.set(p.contract, list);
  }

  return filtered.map(contract => {
    const payments = (byContract.get(contract.id) || []).sort((a, b) => a.seq - b.seq);
    return {
      contract,
      payments,
      totals: summarize(payments),
      customerName: contract.expand?.customer?.name || contract.customer_name || '—',
      customerCode: contract.expand?.customer?.mkh || '',
      zoneName: contract.expand?.zone?.name || '—',
      zoneCode: contract.expand?.zone?.code || '',
    };
  });
}

/** Bảng khối lượng & đơn giá của một hợp đồng. */
export async function fetchItems(contractId: string): Promise<ContractItem[]> {
  return pb.collection(C_ITEM).getFullList<ContractItem>({
    filter: `contract = "${contractId}"`, sort: 'seq',
  });
}

export async function fetchContract(id: string): Promise<ContractWithSchedule> {
  const contract = await pb.collection(C_CONTRACT).getOne<Contract>(id, { expand: 'customer,zone' });
  const payments = await pb.collection(C_PAYMENT).getFullList<Payment>({
    filter: `contract = "${id}"`,
    sort: 'seq',
  });
  return {
    contract,
    payments,
    totals: summarize(payments),
    customerName: contract.expand?.customer?.name || contract.customer_name || '—',
    customerCode: contract.expand?.customer?.mkh || '',
    zoneName: contract.expand?.zone?.name || '—',
    zoneCode: contract.expand?.zone?.code || '',
  };
}

/* ------------------------------------------------------------------- Ghi */

export type ContractInput = Omit<Contract, 'id' | 'expand' | 'created' | 'updated'>;
export type PaymentInput = Omit<Payment, 'id' | 'contract'>;

/**
 * Lưu hợp đồng kèm lịch đợt.
 *
 * Thứ tự: ghi hợp đồng trước, rồi đồng bộ các đợt (thêm/sửa/xoá theo `seq`).
 * Đợt đã ghi nhận thu tiền thì **không xoá** — nếu bản nháp mới bỏ đợt đó đi,
 * ném lỗi để người nhập tự xử lý, thay vì âm thầm xoá mất phiếu thu đã đối
 * chiếu với kế toán.
 */
export async function saveContract(
  input: ContractInput,
  schedule: PaymentInput[],
  contractId?: string,
  items?: ItemInput[],
): Promise<string> {
  const saved = contractId
    ? await pb.collection(C_CONTRACT).update<Contract>(contractId, input)
    : await pb.collection(C_CONTRACT).create<Contract>(input);

  const existing = contractId
    ? await pb.collection(C_PAYMENT).getFullList<Payment>({
        filter: `contract = "${saved.id}"`, sort: 'seq',
      })
    : [];

  const keepSeq = new Set(schedule.map(s => s.seq));
  for (const old of existing) {
    if (keepSeq.has(old.seq)) continue;
    if ((old.amount_paid || 0) > 0 || dayOf(old.paid_date)) {
      throw new Error(
        `Đợt ${old.seq} đã ghi nhận thu tiền nên không xoá được. ` +
        `Xoá phiếu thu của đợt đó trước, rồi hãy sửa lịch thanh toán.`
      );
    }
    await pb.collection(C_PAYMENT).delete(old.id);
  }

  for (const row of schedule) {
    const old = existing.find(e => e.seq === row.seq);
    const body = { ...row, contract: saved.id };
    if (old) await pb.collection(C_PAYMENT).update(old.id, body);
    else await pb.collection(C_PAYMENT).create(body);
  }

  /* Bảng khối lượng: thay nguyên bảng (không có ràng buộc lịch sử như đợt thu). */
  if (items) {
    const oldItems = contractId ? await fetchItems(saved.id) : [];
    for (const o of oldItems) await pb.collection(C_ITEM).delete(o.id);
    for (const it of items) {
      await pb.collection(C_ITEM).create({
        ...it, contract: saved.id, amount: Math.round((it.qty || 0) * (it.unit_price || 0)),
      });
    }
  }

  return saved.id;
}

/**
 * Sửa thẳng số đã thu / ngày thu của từng đợt (sửa nhanh ngay trên thẻ hợp đồng).
 *
 * Khác `recordPayment`: ở đây người dùng tự quyết đợt nào bao nhiêu, không rải
 * tự động — dùng khi chỉnh lại số liệu cũ chứ không phải ghi nhận khoản thu mới.
 */
export async function savePaymentEdits(
  edits: { id: string; amount_paid?: number; paid_date?: string; invoice_date?: string }[],
): Promise<void> {
  for (const e of edits) {
    /* CHỈ ghi đúng ô người dùng đã đụng. Gửi mọi ô kèm giá trị mặc định thì sửa
       một ô sẽ xoá các ô còn lại — đã dính đúng lỗi này khi thử. */
    const body: Record<string, unknown> = {};
    if ('amount_paid' in e) body.amount_paid = e.amount_paid ?? 0;
    if ('paid_date' in e) body.paid_date = e.paid_date || '';
    if ('invoice_date' in e) body.invoice_date = e.invoice_date || '';
    if (Object.keys(body).length === 0) continue;
    await pb.collection(C_PAYMENT).update(e.id, body);
  }
}

export async function deleteContract(id: string): Promise<void> {
  // qlvh_payment.contract có cascadeDelete → các đợt tự xoá theo.
  await pb.collection(C_CONTRACT).delete(id);
}
