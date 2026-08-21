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
  allocatePayment, dayOf, summarize,
  type AllocationResult, type ContractTotals, type PaymentLike,
} from './qlvhRules';

export * from './qlvhRules';

export const C_CONTRACT = 'qlvh_contract';
export const C_PAYMENT = 'qlvh_payment';

/* ------------------------------------------------------------------ Kiểu */

export type ContractStatus = 'dang_hieu_luc' | 'tam_dung' | 'da_thanh_ly';

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  dang_hieu_luc: 'Đang hiệu lực',
  tam_dung:      'Tạm dừng',
  da_thanh_ly:   'Đã thanh lý',
};

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
  invoice_no?: string;
  note?: string;
}

/** Hợp đồng kèm lịch đợt và số liệu tổng hợp — thứ các màn hình thật sự dùng. */
export interface ContractWithSchedule {
  contract: Contract;
  payments: Payment[];
  totals: ContractTotals;
  customerName: string;
  zoneName: string;
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
      customerName: contract.expand?.customer?.name || '—',
      zoneName: contract.expand?.zone?.name || '—',
    };
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
    customerName: contract.expand?.customer?.name || '—',
    zoneName: contract.expand?.zone?.name || '—',
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

  return saved.id;
}

/**
 * Ghi nhận một khoản thu và rải vào các đợt chưa thu đủ.
 * Trả về kết quả phân bổ để giao diện báo lại (nhất là `leftover` — tiền thừa).
 */
export async function recordPayment(
  contractId: string,
  amount: number,
  paidDate: string,
  invoiceNo?: string,
): Promise<AllocationResult> {
  const payments = await pb.collection(C_PAYMENT).getFullList<Payment>({
    filter: `contract = "${contractId}"`, sort: 'seq',
  });

  const result = allocatePayment(payments, amount, paidDate);
  for (const ch of result.changes) {
    if (!ch.id) continue;
    const body: Record<string, unknown> = { amount_paid: ch.amount_paid, paid_date: ch.paid_date };
    if (invoiceNo) body.invoice_no = invoiceNo;
    await pb.collection(C_PAYMENT).update(ch.id, body);
  }
  return result;
}

export async function deleteContract(id: string): Promise<void> {
  // qlvh_payment.contract có cascadeDelete → các đợt tự xoá theo.
  await pb.collection(C_CONTRACT).delete(id);
}
