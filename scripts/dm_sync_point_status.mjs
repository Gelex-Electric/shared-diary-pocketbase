#!/usr/bin/env node
/**
 * Tính lại trạng thái vận hành cho MỌI điểm đo và ghi vào `dm_point.status`.
 *
 * Vì sao cần chạy định kỳ: trạng thái phụ thuộc vào việc đã phát sinh hóa đơn
 * hay chưa, mà hóa đơn về theo ngày — một điểm đo "Chưa vận hành" hôm nay có
 * thể thành "Đang vận hành" ngày mai mà chẳng ai mở form ra sửa. Vì thế
 * GitHub Actions gọi script này 00:00 giờ VN hằng ngày
 * (`.github/workflows/dm-point-status.yml`).
 *
 * Luật suy trạng thái nằm ở `src/lib/dm/pointStatus.ts` — script bundle thẳng
 * module đó bằng esbuild, không chép lại, để giao diện và cron luôn cùng luật.
 *
 * CHỈ ghi `dm_point.status`, và chỉ ghi những điểm đo thực sự đổi trạng thái.
 * Không đụng collection nào khác.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_sync_point_status.mjs
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

const LABEL = {
  du_kien: 'Dự kiến',
  chua_van_hanh: 'Chưa vận hành',
  active: 'Đang vận hành',
  thao_go: 'Đã tháo gỡ',
};

async function loadModules() {
  const dir = mkdtempSync(join(tmpdir(), 'dm-status-'));
  const outStatus = join(dir, 'pointStatus.mjs');
  const outLife = join(dir, 'lifecycle.mjs');
  await build({
    entryPoints: [join(ROOT, 'src/lib/dm/pointStatus.ts'), join(ROOT, 'src/lib/dm/lifecycle.ts')],
    outdir: dir, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    outExtension: { '.js': '.mjs' },
  });
  return {
    status: await import(pathToFileURL(outStatus).href),
    life: await import(pathToFileURL(outLife).href),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function main() {
  if (!EMAIL || !PASSWORD) { console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(1); }
  const { status: S, life: L, cleanup } = await loadModules();
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

    const changes = [];
    const tally = {};
    for (const p of points) {
      const rows = assets.filter(a => a.point === p.id);
      const mkh = mkhById.get(p.customer);
      // Có hóa đơn GẦN ĐÂY (40 ngày) hay không: xét công tơ ĐANG hoạt động, khớp
      // cả số công tơ lẫn mã khách hàng — công tơ tái sử dụng cho khách khác
      // không tính. Ngừng phát sinh cả năm thì không còn là đang vận hành.
      const hasRecentInvoice = rows.some(a =>
        a.type === 'CONGTO' && a.active
        && L.segmentOf(L.segmentsOf(invBySerial.get(a.serial) ?? []), mkh)?.isCurrent === true);

      const next = S.derivePointStatus({ ...S.countAssets(rows), hasRecentInvoice });
      tally[next] = (tally[next] ?? 0) + 1;
      if ((p.status ?? '') !== next) changes.push({ id: p.id, code: p.code, from: p.status ?? '', to: next });
    }

    console.log('Phân bố trạng thái sau khi tính:');
    for (const [k, n] of Object.entries(tally)) console.log(`   ${LABEL[k].padEnd(16)} ${n}`);

    console.log(`\n── SẼ ĐỔI ${changes.length} ĐIỂM ĐO`);
    for (const c of changes) {
      console.log(`   ~ ${(c.code || c.id).padEnd(30)} ${(LABEL[c.from] ?? '(chưa có)').padEnd(16)} → ${LABEL[c.to]}`);
    }

    if (!APPLY) { console.log('\n[DRY-RUN] Không ghi gì. Thêm --apply để ghi thật.'); return; }
    if (!changes.length) { console.log('\nKhông có gì thay đổi.'); return; }

    for (const c of changes) await api('PATCH', `/api/collections/dm_point/records/${c.id}`, { status: c.to });
    console.log(`\n✓ Đã cập nhật ${changes.length} điểm đo.`);
  } finally { cleanup(); }
}

main().catch(e => { console.error(e); process.exit(1); });
