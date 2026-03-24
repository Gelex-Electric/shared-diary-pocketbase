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
  console.log(`📊 PocketBase sẽ proxy qua /pb`);

  // ===================== PROXY POCKETBASE =====================
  app.use('/pb', createProxyMiddleware({
    target: 'http://localhost:8090',
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/pb': '' },
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
      res.status(500).send('Proxy error');
    }
  }));

  // ===================== PRODUCTION =====================
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    app.get('*', (req, res) => {
      if (req.path.startsWith('/pb')) return;   // KHÔNG chặn /pb
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
    console.log(`🔗 PocketBase Admin: http://localhost:${PORT}/pb/_/`);
  });
}

startServer().catch(err => {
  console.error('❌ Lỗi server:', err);
  process.exit(1);
});
