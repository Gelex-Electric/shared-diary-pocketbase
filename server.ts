import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Proxy PocketBase
  app.use('/pb', createProxyMiddleware({
    target: 'http://localhost:8090',
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/pb': '' },
    timeout: 30000,
    proxyTimeout: 30000,
    on: {
      error: (err, req, res) => {
        console.error('Proxy error:', err.message);
        // @ts-ignore
        res.status(502).send('PocketBase chưa sẵn sàng. Vui lòng chờ 10-15 giây rồi refresh lại.');
      }
    }
  }));

  // Proxy HES API
  app.use('/hes', createProxyMiddleware({
    target: 'http://14.225.244.63:8899',
    changeOrigin: true,
    pathRewrite: { '^/hes': '' },
    timeout: 30000,
    proxyTimeout: 30000,
    on: {
      error: (err, req, res) => {
        console.error('HES Proxy error:', err.message);
        // @ts-ignore
        res.status(502).send('HES API không phản hồi.');
      }
    }
  }));

  // Redirect /_/ → /pb/_/
  app.get('/_', (req, res) => res.redirect('/pb/_/'));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    app.get('*', (req, res) => {
      if (req.path.startsWith('/pb') || req.path === '/_') return;
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server chạy trên port ${PORT}`);
  });
}

startServer();
