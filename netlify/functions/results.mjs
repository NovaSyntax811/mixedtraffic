// Researcher access to the collected results (secret protected).
// Setup (once): in the Netlify UI set an environment variable RESULTS_KEY to
// a long random string. Without it this endpoint refuses everything.
//
//   GET /api/results?key=SECRET            -> list of stored sessions
//   GET /api/results?key=SECRET&file=NAME  -> one session JSON
//   GET /api/results?key=SECRET&all=1      -> every session merged into one array
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const secret = process.env.RESULTS_KEY;
  if (!secret || key !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const store = getStore('results');
  const file = url.searchParams.get('file');
  if (file) {
    const data = await store.get(file, { type: 'json' });
    if (data === null) return new Response('Not found', { status: 404 });
    return Response.json(data);
  }
  const { blobs } = await store.list();
  if (url.searchParams.get('all')) {
    const out = [];
    for (const b of blobs) out.push(await store.get(b.key, { type: 'json' }));
    return Response.json(out);
  }
  return Response.json(blobs.map((b) => ({ file: b.key })));
};

export const config = { path: '/api/results' };
