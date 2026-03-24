import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  console.log(`🚀 Server starting on port ${PORT}`);

  // ===================== PROXY POCKETBASE (FIX COOKIE + HTTPS) =====================
  app.use('/pb', createProxyMiddleware({
    target: 'http://localhost:8090',
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/pb': '' },
    secure: false,

    // Fix cookie cho login (HTTPS + Railway)
    cookieDomainRewrite: { '*': '' },
    onProxyRes: (proxyRes, req, res) => {
      const cookies = proxyRes.headers['set-cookie'];
      if (cookies) {
        proxyRes.headers['set-cookie'] = cookies.map(cookie =>
          cookie
            .replace(/Domain=[^;]+/gi, '')                    // xóa domain cũ
            .replace(/SameSite=None/gi, 'SameSite=Lax')       // fix SameSite
            .replace(/Secure/gi, '')                          // không cần Secure khi proxy HTTP nội bộ
        );
      }
    },
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
      res.status(502).send('Proxy error - PocketBase chưa sẵn sàng');
    }
  }));

  // Tự động redirect /_/ → /pb/_/ (cho người quen link cũ)
  app.get('/_', (req, res) => {
    res.redirect('/pb/_/');
  });

  // ===================== PRODUCTION =====================
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    app.get('*', (req, res) => {
      if (req.path.startsWith('/pb') || req.path === '/_') return;
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server chạy tại https://getc.up.railway.app`);
    console.log(`🔗 PocketBase Admin: https://getc.up.railway.app/pb/_/`);
  });
}

startServer().catch(err => {
  console.error('❌ Lỗi server:', err);
  process.exit(1);
});
