import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // ===================== REDIRECT TRƯỚC PROXY =====================
  // Fix lỗi truy cập trực tiếp /_/
  app.get('/_', (req, res) => {
    res.redirect('/pb/_/');
  });

  // ===================== PROXY POCKETBASE (phiên bản đơn giản) =====================
  app.use('/pb', createProxyMiddleware({
    target: 'http://localhost:8090',
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/pb': '' },
  }));

  // ===================== PRODUCTION =====================
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    // Catch-all cho React (không chặn /pb và /_)
    app.get('*', (req, res) => {
      if (req.path.startsWith('/pb') || req.path === '/_') return;
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server chạy trên port ${PORT}`);
    console.log(`🔗 PocketBase Admin: https://getc.up.railway.app/pb/_/`);
  });
}

startServer();
