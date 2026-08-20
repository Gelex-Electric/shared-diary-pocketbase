#!/usr/bin/env node
/**
 * DRY-RUN đồng bộ khách hàng từ hóa đơn — xem trước sẽ tạo/sửa những gì.
 *
 * CHỈ ĐỌC, KHÔNG GHI GÌ. Việc ghi làm trên giao diện (tab Khách hàng → nút
 * "Đồng bộ từ hóa đơn"), có hộp xác nhận. Script này để soi kế hoạch trước.
 *
 * Bundle thẳng `src/lib/dm/customerSync.ts` bằng esbuild, không chép lại logic.
 *
 * Chạy: PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_check_customer_sync.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';

async function loadModule() {
  const dir = mkdtempSync(join(tmpdir(), 'dm-sync-'));
  const out = join(dir, 'customerSync.mjs');
  await build({
    entryPoints: [join(ROOT, 'src/lib/dm/customerSync.ts')],
    outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  return { mod: await import(pathToFileURL(out).href), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const cut = (s, n) => (s ?? '').length > n ? `${s.slice(0, n)}…` : (s ?? '');

async function main() {
  if (!EMAIL || !PASSWORD) { console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(1); }
  const { mod, cleanup } = await loadModule();
  try {
    const { latestByMkh, planCustomerSync, isEmptyPlan } = mod;

    const auth = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
    });
    if (!auth.ok) { console.error('Đăng nhập PB thất bại:', auth.status); process.exit(1); }
    const { token } = await auth.json();
    const get = async (p) => {
      const r = await fetch(`${PB_URL}${p}`, { headers: { Authorization: token } });
      if (!r.ok) { console.error(`HTTP ${r.status} ${p}`); process.exit(1); }
      return r.json();
    };

    let facts = [];
    for (let page = 1; ; page++) {
      const r = await get(`/api/collections/invoice/records?perPage=500&page=${page}&fields=MKHang,NMua,DChiNMua,EndDate`);
      facts = facts.concat(r.items);
      if (page >= r.totalPages) break;
    }
    const zones = (await get('/api/collections/dm_zone/records?perPage=500')).items;
    const customers = (await get('/api/collections/dm_customer/records?perPage=500')).items;

    const latest = latestByMkh(facts);
    const plan = planCustomerSync(latest, zones, customers);

    console.log(`PB ${PB_URL}`);
    console.log(`invoice ${facts.length} · ${latest.length} mã KH · dm_zone ${zones.length} · dm_customer ${customers.length}\n`);

    console.log(`── SẼ TẠO ${plan.zonesToCreate.length} KCN`);
    for (const z of plan.zonesToCreate) console.log(`   + ${z.code.padEnd(8)} ${z.name}`);
    if (plan.unknownZoneCodes.length) {
      console.log(`   ⚠ mã KCN lạ, KHÔNG tự tạo: ${plan.unknownZoneCodes.join(', ')}`);
    }

    console.log(`\n── SẼ TẠO ${plan.customersToCreate.length} KHÁCH HÀNG`);
    for (const c of plan.customersToCreate.slice(0, 8)) {
      console.log(`   + ${c.mkh.padEnd(12)} [${c.zoneCode}] ${cut(c.name, 58)}  (theo kỳ ${c.asOf})`);
    }
    if (plan.customersToCreate.length > 8) console.log(`   … và ${plan.customersToCreate.length - 8} khách nữa`);

    console.log(`\n── SẼ CẬP NHẬT ${plan.customersToUpdate.length} KHÁCH HÀNG`);
    for (const u of plan.customersToUpdate) {
      console.log(`   ~ ${u.mkh}`);
      for (const ch of u.changes) {
        console.log(`       ${ch.field.padEnd(8)} "${cut(ch.from, 46)}"`);
        console.log(`       ${' '.repeat(8)} → "${cut(ch.to, 46)}"`);
      }
    }

    if (plan.untouchedMkh.length) {
      console.log(`\n── GIỮ NGUYÊN (chưa có hóa đơn): ${plan.untouchedMkh.join(', ')}`);
    }
    console.log(`\nKhách mới sẽ CHƯA CÓ tên tắt: ${plan.customersToCreate.length} (phải khai tay mới sinh được mã trạm)`);
    console.log(isEmptyPlan(plan) ? '\nKhông có gì thay đổi.' : '\n[DRY-RUN] Script này không ghi gì.');
  } finally { cleanup(); }
}

main().catch(e => { console.error(e); process.exit(1); });
