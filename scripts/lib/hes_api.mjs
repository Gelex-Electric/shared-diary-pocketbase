/**
 * Phần dùng chung khi gọi API HES (`document/API_HES.md`).
 *
 * Gom lại để `hes_check_meters.mjs` và `fetch_hes_index.mjs` không mỗi nơi một
 * kiểu retry, một kiểu giới hạn luồng — HES là máy chủ nội bộ, dội hết một lúc
 * là nó trả 5xx cho tất cả.
 *
 * Token: ưu tiên `API_TOKEN` đã có sẵn (quy ước trong CLAUDE.md — chỉ gọi Login
 * khi hàm khác lỗi không trả kết quả), không có thì mới đăng nhập bằng
 * `API_USER`/`API_PASS`.
 */
export const BASE_URL = process.env.HES_BASE_URL || 'http://14.225.244.63:8899/api';

const pad = (n) => String(n).padStart(2, '0');

/** Mốc thời gian dạng `yyyyMMddHHmmss` mà API HES đòi. */
export const stamp = (d) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/**
 * GET trả JSON, có retry cho lỗi mạng và 5xx (server hay 5xx lúc khởi động lạnh).
 * Lỗi 4xx trả về luôn — retry cũng không đổi kết quả.
 */
export async function getJson(path, params, { attempts = 4, timeoutMs = 60000 } = {}) {
  const url = `${BASE_URL}/${path}?${new URLSearchParams(params)}`;
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.status < 500) return await r.json();
      last = `${r.status} tại ${path}`;
    } catch (e) {
      last = String(e);
    }
    if (i < attempts - 1) await new Promise(s => setTimeout(s, 5000 * (i + 1)));
  }
  throw new Error(last);
}

/**
 * Token dùng cho mọi lời gọi. `API_TOKEN` có sẵn thì dùng luôn, không đăng nhập.
 * Đăng nhập xong nhớ ghi token mới vào cuối mục Login của `document/API_HES.md`.
 */
export async function getToken() {
  const ready = (process.env.API_TOKEN || '').trim();
  if (ready) return ready;

  const UserAccount = process.env.API_USER || '';
  const Password = process.env.API_PASS || '';
  if (!UserAccount || !Password) {
    throw new Error('Thiếu API_TOKEN, và cũng thiếu API_USER/API_PASS để đăng nhập.');
  }
  let data = await getJson('Login', { UserAccount, Password }, { timeoutMs: 30000 });
  if (Array.isArray(data)) data = data[0] ?? {};
  if (String(data.CODE) !== '1') throw new Error(`Login thất bại: ${data.MESSAGE}`);
  return data.TOKEN;
}

/**
 * Chạy song song có TRẦN — giữ nguyên thứ tự kết quả theo thứ tự đầu vào.
 * Lỗi của một phần tử không làm hỏng cả mẻ, nó thành `{ error }` tại đúng chỗ đó.
 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: String(e).slice(0, 60) }; }
    }
  }));
  return out;
}
