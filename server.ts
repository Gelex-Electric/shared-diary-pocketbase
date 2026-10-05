import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { einvoiceRouter } from './server/einvoiceApi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;   // ← BẮT BUỘC phải giữ dòng này cho Railway

  // ==================== PROXY POCKETBASE ====================
  app.use('/pb', createProxyMiddleware({
    target: 'http://localhost:8090',
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/pb': '' },
    timeout: 30000,
    proxyTimeout: 30000,
    on: {
      error: (err, req, res) => {
        console.error('Proxy PocketBase error:', err.message);
        // @ts-ignore
        res.status(502).send('PocketBase chưa sẵn sàng. Vui lòng chờ 10-15 giây rồi refresh lại.');
      }
    }
  }));

  // ==================== PROXY HES API (mới thêm) ====================
  app.use('/hes', createProxyMiddleware({
    // HES_BASE_URL (Railway Variables) dạng http://host:port/api — proxy cần bỏ /api.
    target: (process.env.HES_BASE_URL || 'http://14.225.175.172:8899/api').replace(/\/api\/?$/, ''),
    changeOrigin: true,
    pathRewrite: { '^/hes': '' },
    timeout: 30000,
    proxyTimeout: 30000,
    on: {
      error: (err, req, res) => {
        console.error('Proxy HES error:', err.message);
        // @ts-ignore
        res.status(502).send('HES API không phản hồi. Vui lòng kiểm tra kết nối.');
      }
    }
  }));

  // ==================== PROXY CCIS / HĐĐT (SOAP muabandien) ====================
  // Lấy XML hóa đơn điện tử trực tiếp từ web service GELEX (tránh CORS trình duyệt).
  app.use('/ccis', createProxyMiddleware({
    target: 'https://muabandien.gelex-electric.com',
    changeOrigin: true,
    pathRewrite: { '^/ccis': '' },
    timeout: 120000,
    proxyTimeout: 120000,
    on: {
      error: (err, req, res) => {
        console.error('Proxy CCIS error:', err.message);
        // @ts-ignore
        res.status(502).send('Dịch vụ HĐĐT (muabandien) không phản hồi. Vui lòng thử lại.');
      }
    }
  }));

  // ==================== API HÓA ĐƠN ĐIỆN TỬ (BILLVAL + PDF CCIS) ====================
  // Đứng TRƯỚC static + SPA fallback. Khóa CCIS_BILLVAL_KEY chỉ dùng ở đây (server/ccis.ts).
  app.use('/api/einvoice', einvoiceRouter());

  // Redirect /_/ → /pb/_/ cho tiện vào Admin UI
  app.get('/_', (req, res) => res.redirect('/pb/_/'));

  // ==================== STATIC: public/ (CSV, PDF, assets tĩnh) ====================
  // Phục vụ thư mục public/ trực tiếp cho cả dev & prod
  // (đảm bảo /document.pdf luôn tìm thấy)
  app.use(express.static(path.join(__dirname, 'public')));

  // ==================== DEV MODE (Vite middleware) ====================
  if (process.env.NODE_ENV !== 'production') {
    console.log('🛠️  Chạy ở chế độ Development với Vite middleware...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
  // ==================== PRODUCTION MODE (Railway) ====================
  else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    // SPA fallback
    app.get('*', (req, res) => {
      if (req.path.startsWith('/pb') || req.path === '/_' || req.path.startsWith('/hes') || req.path.startsWith('/ccis') || req.path.startsWith('/api')) {
        res.status(404).end();
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });

    console.log('🚀 Chạy ở chế độ Production (serve dist)');
  }

  // ==================== START SERVER ====================
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server chạy trên port ${PORT}`);
    console.log(`📡 PocketBase: http://localhost:${PORT}/pb/_/`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
    if (process.env.NODE_ENV === 'production') {
      console.log(`🔗 HES Proxy: http://localhost:${PORT}/hes`);
    }
  });
}

startServer();