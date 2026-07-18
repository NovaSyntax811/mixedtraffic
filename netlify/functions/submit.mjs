// Results collection endpoint for the quantitative study.
// POST /api/submit with the session JSON; stored in the Netlify Blobs store
// "results", one blob per session, keyed by participant id + timestamp.
// No secret on purpose: participants must be able to submit. Reading the
// data back requires the RESULTS_KEY secret (see results.mjs).
import { getStore } from '@netlify/blobs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const raw = JSON.stringify(payload);
  if (raw.length > 3_000_000) {
    return new Response('Payload too large', { status: 413 });
  }
  const pid = String(payload?.participant ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'unknown';
  const key = `${pid}-${Date.now()}.json`;
  const store = getStore('results');
  await store.setJSON(key, { receivedAt: new Date().toISOString(), ...payload });
  return Response.json({ ok: true, key });
};

export const config = { path: '/api/submit' };
