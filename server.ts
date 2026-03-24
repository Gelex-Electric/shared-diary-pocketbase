import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();

  // ← DÒNG QUAN TRỌNG NHẤT CHO RAILWAY
  const PORT = parseInt(process.env.PORT || '3000', 10);

  console.log(`[INFO] PORT từ Railway: ${process.env.PORT || 'không có'} → Sử dụng: ${PORT}`);

  // Health check (dùng để test)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', port: PORT, env: process.env.NODE_ENV });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server chạy thành công trên port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('❌ Lỗi khởi động server:', err);
  process.exit(1);
});
