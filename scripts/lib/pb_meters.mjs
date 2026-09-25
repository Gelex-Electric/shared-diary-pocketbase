/**
 * Đọc danh mục công tơ từ PocketBase cho các script HES.
 *
 * Vì sao có file này: `metterinfo.csv` là bản kết xuất từ HES do pipeline chạy
 * hằng đêm — trễ một ngày và không biết gì về những gì vừa khai trong Danh mục.
 * Danh mục `dm_*` mới là nơi người dùng khai và sửa (user chốt 25/08/2026), nên
 * script phải lấy theo đó.
 *
 * HSN lấy từ `dm_point.hsn` — thuộc ĐIỂM ĐO, không thuộc công tơ. Giá trị đó do
 * app suy sẵn bằng `(TI sơ/TI thứ) × (TU sơ/TU thứ)` theo bộ TI/TU ĐANG TREO
 * (xem `src/lib/dm/hsn.ts`). Script chỉ ĐỌC, tuyệt đối không tính lại: luật HSN
 * phải nằm một chỗ duy nhất, sai một ly là sai toàn bộ sản lượng.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

/*
  MẠNG CÔNG TY CHẶN CERT CỦA NODE.

  Trên GitHub Actions `fetch` chạy bình thường, nhưng chạy TAY ở máy công ty thì
  `fetch` ném lỗi cert, `pbLogin` nuốt lỗi rồi báo "sai tài khoản/mật khẩu" —
  thông báo dẫn người đọc đi sai hướng hoàn toàn (đã mất thời gian vì nó ngày
  23/09/2026). `curl` thì tin trust store của Windows nên vẫn gọi được.

  Cách xử lý: thử `fetch` trước, hỏng thì rơi sang `curl`. Không đảo thứ tự —
  Actions không có gì bảo đảm là có `curl`.
*/
let useCurl = false;

const curlJson = (args) => {
  const out = execFileSync('curl', ['-s', '-m', '60', ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out ? JSON.parse(out) : {};
};

/** GET JSON, tự rơi sang curl khi fetch hỏng vì cert. */
async function getJson(url, headers = {}) {
  if (!useCurl) {
    try {
      return await (await fetch(url, { headers })).json();
    } catch (e) {
      useCurl = true;
      console.error(`[pb] fetch hỏng (${e?.message ?? e}) → chuyển sang curl.`);
    }
  }
  const h = Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]);
  return curlJson([url, ...h]);
}

/** POST JSON với thân đi qua FILE tạm — không để mật khẩu lộ trên dòng lệnh. */
async function postJson(url, body) {
  if (!useCurl) {
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { ok: r.ok, json: await r.json() };
    } catch (e) {
      useCurl = true;
      console.error(`[pb] fetch hỏng (${e?.message ?? e}) → chuyển sang curl.`);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'pb-'));
  const f = join(dir, 'body.json');
  try {
    writeFileSync(f, JSON.stringify(body));
    const j = curlJson(['-X', 'POST', url, '-H', 'Content-Type: application/json',
      '--data-binary', `@${f}`]);
    return { ok: !!j?.token, json: j };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Ngày dạng `YYYY-MM-DD`; PB lưu ISO nên cắt lấy phần ngày. */
export const ymd = (v) => String(v ?? '').slice(0, 10);
const N = (s) => String(s ?? '').trim();

/**
 * Đăng nhập PocketBase, trả token. Thử `_superusers` trước rồi `users` — script
 * chạy bằng tài khoản quản trị, nhưng khi chạy tay có thể chỉ có tài khoản thường.
 */
export async function pbLogin(email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL,
                              password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD) {
  /*
    Thiếu biến và sai mật khẩu là hai lỗi khác nhau — gộp làm một thì người chạy
    cứ ngồi soi lại mật khẩu trong khi thật ra chưa truyền biến nào cả.

    Chấp nhận HAI bộ tên: `PB_EMAIL`/`PB_PASS` là tên pipeline dùng (bước 1 của
    daily-pipeline.yml truyền xuống), `PB_ADMIN_EMAIL`/`PB_ADMIN_PASSWORD` là tên
    các script `dm_*.mjs` chạy tay vẫn dùng. Giữ cả hai để không phải sửa thói
    quen gõ lệnh của ai.
  */
  if (!email || !password) {
    throw new Error('Thiếu tài khoản PocketBase. Truyền PB_EMAIL/PB_PASS '
      + '(tên pipeline dùng) hoặc PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD (tên chạy tay).');
  }
  for (const coll of ['_superusers', 'users']) {
    try {
      const { ok, json } = await postJson(
        `${PB_URL}/api/collections/${coll}/auth-with-password`, { identity: email, password });
      if (ok && json?.token) return json.token;
    } catch { /* thử collection tiếp theo */ }
  }
  throw new Error(`Đăng nhập PocketBase thất bại (${PB_URL}) — sai tài khoản/mật khẩu, `
    + 'hoặc tài khoản không có quyền đọc danh mục.');
}

/** Lấy HẾT bản ghi của một collection — `dm_asset` đã vượt 500, một trang là thiếu im lặng. */
export async function allOf(col, token) {
  const headers = { Authorization: token };
  const out = [];
  for (let p = 1; ; p++) {
    const r = await getJson(
      `${PB_URL}/api/collections/${col}/records?perPage=500&page=${p}`, headers);
    out.push(...(r.items ?? []));
    if (p >= (r.totalPages ?? 1)) return out;
  }
}

/**
 * Công tơ ĐANG TREO kèm thông tin điểm đo.
 *
 * "Đang treo" = CÓ ngày treo và CHƯA có ngày tháo — chặt hơn cờ `active`, vì vật
 * tư dự kiến cũng mang `active = true` mà chưa hề ra hiện trường.
 *
 * Trả về `{ meters, points, assets, customers, stations }` để script gọi còn
 * dùng lại dữ liệu thô mà không phải tải PB lần thứ hai.
 */
export async function liveMeters(token) {
  const [points, assets, customers, stations, zones] = await Promise.all(
    ['dm_point', 'dm_asset', 'dm_customer', 'dm_station', 'dm_zone'].map(c => allOf(c, token)));

  const pointById = new Map(points.map(p => [p.id, p]));
  const mkhOf = (id) => customers.find(c => c.id === id)?.mkh ?? '';
  const sdmOf = (id) => stations.find(s => s.id === id)?.sdm_kva;
  const zoneName = new Map(zones.map(z => [z.id, z.name]));
  /* KCN lấy theo TRẠM: khách thuê nhà xưởng có thể khai ở KCN khác nơi đặt công tơ. */
  const lines = await allOf('dm_line', token);
  /* Điểm ĐẦU NGUỒN (role dau_nguon, schema v17) không có trạm ⇒ lấy `zone` của chính
     nó, thiếu thì KCN của lộ. Thiếu nhánh này thì KCN rỗng, cảnh báo mất KCN. */
  const zoneOfPoint = (p) => zoneName.get(
    stations.find(s => s.id === p?.station)?.zone
    || p?.zone
    || lines.find(l => l.id === p?.line)?.zone) ?? '';

  const meters = assets
    .filter(a => a.type === 'CONGTO' && ymd(a.date_on) && !ymd(a.date_off) && a.point)
    .map(a => {
      const p = pointById.get(a.point);
      return {
        serial: N(a.serial), point: p,
        code: p?.code || p?.line_name || '(không rõ)',
        hsn: p?.hsn, mkh: mkhOf(p?.customer), status: p?.status, sdm: sdmOf(p?.station),
        zone: zoneOfPoint(p),
        dateOn: ymd(a.date_on),
      };
    });

  return { meters, points, assets, customers, stations, zones };
}
