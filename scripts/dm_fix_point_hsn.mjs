#!/usr/bin/env node
/**
 * Tính lại `dm_point.hsn` cho mọi điểm đo — vá các điểm đo đang để HSN = 0.
 *
 * NGUYÊN NHÂN GỐC: form chỉ lấy tỷ số của TI ĐANG HOẠT ĐỘNG (luật 19/08 để khi
 * thay TI thì HSN theo TI mới). Điểm đo đã tháo hết vật tư không còn TI hoạt
 * động nào ⇒ không suy được tỷ số ⇒ HSN rơi về 0. Đã xảy ra với
 * `TH.BQL.T2.160kVA.HANA` (TI 100/5, HSN đúng 20) và `TH.GIZA.T1.250kVA`
 * (TI 400/5, HSN đúng 80). HSN sai là SẢN LƯỢNG SAI, nên phải vá cả dữ liệu cũ.
 *
 * Thứ tự suy (dùng chung `pickRatio` + `deriveHsn` của app, bundle qua esbuild):
 *   1. Tỷ số TI/TU đang hoạt động
 *   2. Cả bộ đã tháo ⇒ tỷ số của cái tháo sau cùng
 *   3. Không có TI nào ⇒ HSN = 1 (công tơ đo thẳng)
 *   4. Suy không ra, hoặc ra 0 ⇒ lấy HSN hóa đơn của công tơ ở điểm đo đó
 *
 * CHỈ ghi `dm_point.hsn` (và `connection` suy theo), chỉ ghi điểm thực sự lệch.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_fix_point_hsn.mjs
 *   … thêm --apply để ghi thật
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
const APPLY = process.argv.includes('--apply');

async function loadModules() {
  const dir = mkdtempSync(join(tmpdir(), 'dm-hsn-'));
  await build({
    entryPoints: [join(ROOT, 'src/lib/dm/hsn.ts'), join(ROOT, 'src/lib/dm/lifecycle.ts')],
    outdir: dir, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    outExtension: { '.js': '.mjs' },
  });
  return {
    hsn: await import(pathToFileURL(join(dir, 'hsn.mjs')).href),
    life: await import(pathToFileURL(join(dir, 'lifecycle.mjs')).href),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function main() {
  if (!EMAIL || !PASSWORD) { console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(1); }
  const { hsn: H, life: L, cleanup } = await loadModules();
  try {
    const auth = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
    });
    if (!auth.ok) { console.error('Đăng nhập PB thất bại:', auth.status); process.exit(1); }
    const { token } = await auth.json();
    const api = async (method, path, body) => {
      const r = await fetch(`${PB_URL}${path}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: token },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) { console.error(`HTTP ${r.status} ${method} ${path}\n${text.slice(0, 300)}`); process.exit(1); }
      return text ? JSON.parse(text) : {};
    };
    const all = async (collection, extra = '') => {
      let items = [];
      for (let page = 1; ; page++) {
        const r = await api('GET', `/api/collections/${collection}/records?perPage=500&page=${page}${extra}`);
        items = items.concat(r.items);
        if (page >= r.totalPages) break;
      }
      return items;
    };

    const points = await all('dm_point');
    const assets = await all('dm_asset');
    const customers = await all('dm_customer');
    const invoices = await all('invoice', '&fields=SCT,MKHang,HSN,StartDate,EndDate,ThTien,LoaiHD');

    console.log(`PB ${PB_URL}`);
    console.log(`dm_point ${points.length} · dm_asset ${assets.length} · invoice ${invoices.length}\n`);

    const mkhById = new Map(customers.map(c => [c.id, c.mkh]));
    const invBySerial = L.bySerial(invoices);

    /** Tỷ số của một bộ, đúng thứ tự khai để `pickRatio` biết cái nào tháo sau cùng. */
    const setOf = (rows, type) => rows
      .filter(a => a.type === type && (a.ratio_primary != null || a.ratio_secondary != null))
      .map(a => ({ primary: a.ratio_primary, secondary: a.ratio_secondary, active: a.active }));

    const changes = [];
    for (const p of points) {
      const rows = assets.filter(a => a.point === p.id);
      const mkh = mkhById.get(p.customer);

      const derived = H.deriveHsn({
        hasTi: rows.some(a => a.type === 'TI'),
        ti: H.pickRatio(setOf(rows, 'TI')),
        tu: H.pickRatio(setOf(rows, 'TU')),
      });

      // HSN hóa đơn: ưu tiên công tơ đang hoạt động, không có thì cái cuối cùng.
      const meters = rows.filter(a => a.type === 'CONGTO');
      const hsnOf = (a) => L.segmentOf(L.segmentsOf(invBySerial.get(a.serial) ?? []), mkh)?.hsn;
      const invoiceHsn = meters.filter(a => a.active).map(hsnOf).find(h => h != null)
        ?? meters.map(hsnOf).filter(h => h != null).pop();

      const next = derived != null && derived > 0 ? derived : invoiceHsn;
      if (next == null) continue;                 // không có căn cứ nào ⇒ để nguyên
      if ((p.hsn ?? 0) === next) continue;

      changes.push({
        id: p.id, code: p.code || p.id, from: p.hsn, to: next,
        why: derived != null && derived > 0 ? 'TI/TU' : 'hóa đơn',
        connection: H.connectionOfHsn(next),
      });
    }

    console.log(`── SẼ SỬA ${changes.length} ĐIỂM ĐO`);
    for (const c of changes) {
      console.log(`   ~ ${c.code.padEnd(30)} HSN ${String(c.from).padEnd(6)} → ${String(c.to).padEnd(6)} (theo ${c.why})`);
    }

    if (!APPLY) { console.log('\n[DRY-RUN] Không ghi gì. Thêm --apply để ghi thật.'); return; }
    if (!changes.length) { console.log('\nKhông có gì thay đổi.'); return; }

    for (const c of changes) {
      await api('PATCH', `/api/collections/dm_point/records/${c.id}`, { hsn: c.to, connection: c.connection });
    }
    console.log(`\n✓ Đã sửa ${changes.length} điểm đo.`);
  } finally { cleanup(); }
}

main().catch(e => { console.error(e); process.exit(1); });
