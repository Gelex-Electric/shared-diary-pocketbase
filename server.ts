import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // ===================== PROXY POCKETBASE =====================
  // Tất cả request /pb/* sẽ được chuyển sang PocketBase (localhost:8090)
  app.use('/pb', createProxyMiddleware({
    target: 'http://localhost:8090',
    changeOrigin: true,
    ws: true,                    // hỗ trợ realtime
    pathRewrite: { '^/pb': '' }, // xóa /pb trước khi forward
  }));

  // ===================== PRODUCTION =====================
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    // Catch-all cho React SPA (KHÔNG áp dụng cho /pb)
    app.get('*', (req, res) => {
      if (req.path.startsWith('/pb')) return;
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } 
  // ===================== DEVELOPMENT =====================
  else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`📊 PocketBase Admin: http://localhost:${PORT}/pb/_/`);
  });
}

startServer();
