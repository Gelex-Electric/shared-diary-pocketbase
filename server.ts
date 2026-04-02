import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;   // ← BẮT BUỘC phải giữ dòng này cho Railway

  // ==================== PROXY POCKETBASE ====================
  app.use('/pb', createProxyMiddleware({
    target: 'http://localhost:8090',
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/pb': '' },
    timeout: 30000,
    proxyTimeout: 30000,
    onError: (err, req, res) => {
      console.error('Proxy PocketBase error:', err.message);
      // @ts-ignore
      res.status(502).send('PocketBase chưa sẵn sàng. Vui lòng chờ 10-15 giây rồi refresh lại.');
    }
  }));

  // ==================== PROXY HES API (mới thêm) ====================
  app.use('/hes', createProxyMiddleware({
    target: 'http://14.225.244.63:8899',
    changeOrigin: true,
    pathRewrite: { '^/hes': '' },
    timeout: 30000,
    proxyTimeout: 30000,
    onError: (err, req, res) => {
      console.error('Proxy HES error:', err.message);
      // @ts-ignore
      res.status(502).send('HES API không phản hồi. Vui lòng kiểm tra kết nối.');
    }
  }));

  // Redirect /_/ → /pb/_/ cho tiện vào Admin UI
  app.get('/_', (req, res) => res.redirect('/pb/_/'));

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
      if (req.path.startsWith('/pb') || req.path === '/_' || req.path.startsWith('/hes')) return;
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