import { server } from '../server.mjs';

export default function handler(request, response) {
  const original = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`);
  const route = original.searchParams.get('__vercel_path');
  if (route === null || route.split('/').some((segment) => segment === '.' || segment === '..')) {
    response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: 'Invalid API route.' }));
    return;
  }
  original.searchParams.delete('__vercel_path');
  const query = original.searchParams.toString();
  request.url = `/api/${route}${query ? `?${query}` : ''}`;
  server.emit('request', request, response);
}