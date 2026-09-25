import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
createServer(async (req, res) => {
  if (!['/orders/new','/','/orders/sample/create-order'].includes(req.url)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(await readFile(new URL(req.url === '/orders/sample/create-order' ? '../demo/sas.html' : '../demo/index.html', import.meta.url)));
}).listen(4173, '127.0.0.1', () => console.log('Demo: http://127.0.0.1:4173/orders/new'));
