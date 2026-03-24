import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // ===================== PROXY POCKETBASE (FIX COOKIE AUTH) =====================
  app.use('/pb', createProxyMiddleware({
    target: 'http://localhost:8090',
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/pb': '' },
    secure: false,

    // Fix cookie domain
    cookieDomainRewrite: {
      '*': '',                    // xóa domain localhost
    },

    // Fix Set-Cookie header
    onProxyRes: (proxyRes, req, res) => {
      if (proxyRes.headers['set-cookie']) {
        proxyRes.headers['set-cookie'] = proxyRes.headers['set-cookie'].map(cookie =>
          cookie
            .replace(/Domain=[^;]+/i, '')           // xóa Domain
            .replace(/SameSite=None/i, 'SameSite=Lax') // fix SameSite
        );
      }
    }
  }));

  // ===================== PRODUCTION =====================
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    app.get('*', (req, res) => {
      if (req.path.startsWith('/pb')) return;
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } 
  // ===================== DEV =====================
  else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server chạy tại http://0.0.0.0:${PORT}`);
    console.log(`🔗 PocketBase Admin: https://getc.up.railway.app/pb/_/`);
  });
}

startServer().catch(err => {
  console.error('❌ Lỗi server:', err);
  process.exit(1);
});
