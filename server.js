// Minimal static server for local development
import http from 'http';
import fs from 'fs';
import path from 'path';

const port = process.env.PORT || 8080;
const base = process.cwd();

const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const filePath = path.join(base, reqPath);
  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.statusCode = 404; res.end('Not found'); return;
    }
    if (stats.isDirectory()) {
      res.statusCode = 302; res.setHeader('Location', reqPath + '/index.html'); res.end(); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, () => console.log(`Static server running at http://localhost:${port}`));
