/*
 * 极简静态服务器（零依赖）
 *
 * 为什么需要它：
 *  - 手机上用，必须通过 http(s) 打开，直接传文件过去是不行的
 *  - 同一 Wi-Fi 下孩子手机访问 http://<电脑IP>:5173 即可
 *  - 换成 https 的话建议直接部署到静态托管（CloudBase / GitHub Pages）
 *
 * 跑：npm run serve
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const target = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, ''));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(target, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      // 开发期不要缓存，避免"改了看不到"
      'Cache-Control': 'no-store'
    }).end(buf);
  });
});

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const ips = [];
  Object.keys(nets).forEach(name => {
    (nets[name] || []).forEach(n => {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    });
  });

  console.log('数学小教练已启动\n');
  console.log('  本机：  http://localhost:' + PORT);
  ips.forEach(ip => console.log('  手机：  http://' + ip + ':' + PORT + '   （需与电脑同一 Wi-Fi）'));
  console.log('\n按 Ctrl+C 停止');
});
