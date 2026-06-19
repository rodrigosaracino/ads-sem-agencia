const ALLOWED_FIELDS = [
  'client_id', 'event_type',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src',
  'gclid', 'fbclid',
  'referrer', 'user_agent', 'landing_url'
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== '/api/track') {
      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let data;
    try {
      data = await request.json();
    } catch (_) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const row = {};
    for (const field of ALLOWED_FIELDS) {
      row[field] = typeof data[field] === 'string' ? data[field].slice(0, 2048) : null;
    }
    row.event_type = row.event_type || 'pageview';

    try {
      await env.DB.prepare(`
        INSERT INTO tracking_events
          (client_id, event_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term, src, gclid, fbclid, referrer, user_agent, landing_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        row.client_id, row.event_type,
        row.utm_source, row.utm_medium, row.utm_campaign, row.utm_content, row.utm_term, row.src,
        row.gclid, row.fbclid,
        row.referrer, row.user_agent, row.landing_url,
        new Date().toISOString()
      ).run();

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
