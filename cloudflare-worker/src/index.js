const ALLOWED_FIELDS = [
  'client_id', 'event_type',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src',
  'gclid', 'fbclid',
  'referrer', 'user_agent', 'landing_url'
];

const META_PIXEL_ID = '714107123349981';
const META_API_VERSION = 'v21.0';
const CAPI_EVENT_TYPES = {
  lead: 'Lead',
  checkout_click: 'InitiateCheckout'
};

async function sha256Hex(value) {
  const enc = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function splitName(name) {
  if (!name) return { fn: null, ln: null };
  const parts = name.trim().split(/\s+/);
  return { fn: parts[0] || null, ln: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

async function sendMetaCapi(env, payloadData, request) {
  const eventName = CAPI_EVENT_TYPES[payloadData.event_type];
  if (!eventName || !env.META_CAPI_TOKEN) return;

  const phone = normalizePhone(payloadData.phone);
  const { fn, ln } = splitName(payloadData.name);
  const userData = {
    client_ip_address: request.headers.get('CF-Connecting-IP') || undefined,
    client_user_agent: payloadData.user_agent || undefined
  };
  if (phone) userData.ph = [await sha256Hex(phone)];
  if (fn) userData.fn = [await sha256Hex(fn)];
  if (ln) userData.ln = [await sha256Hex(ln)];
  if (payloadData.client_id) userData.external_id = [await sha256Hex(payloadData.client_id)];
  if (payloadData.fbp) userData.fbp = payloadData.fbp;
  if (payloadData.fbc) userData.fbc = payloadData.fbc;

  const customData = eventName === 'Lead'
    ? { currency: 'BRL', value: 1 }
    : { currency: 'BRL', value: 397, content_name: 'Protocolo Cliente na Porta', content_type: 'product' };

  const body = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: payloadData.event_id || undefined,
      action_source: 'website',
      event_source_url: payloadData.landing_url || undefined,
      user_data: userData,
      custom_data: customData
    }]
  };

  try {
    await fetch(`https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${env.META_CAPI_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (_) {
    // best-effort, never blocks the client response
  }
}

async function sendSlackMessage(env, text) {
  if (!env.SLACK_WEBHOOK_URL) return;
  try {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch (_) {
    // best-effort, never blocks the caller
  }
}

const HOTMART_EVENT_LABELS = {
  PURCHASE_APPROVED: '🎉 Nova venda aprovada!',
  PURCHASE_COMPLETE: '✅ Compra completa!',
  PURCHASE_REFUNDED: '↩️ Compra reembolsada',
  PURCHASE_CHARGEBACK: '⚠️ Chargeback recebido',
  PURCHASE_PROTEST: '🚨 Pedido de reembolso/disputa aberto',
  PURCHASE_CANCELED: '❌ Compra cancelada'
};

async function handleHotmartWebhook(request, env, ctx) {
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const hottok = request.headers.get('x-hotmart-hottok');
  if (!env.HOTMART_HOTTOK || hottok !== env.HOTMART_HOTTOK) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const label = HOTMART_EVENT_LABELS[payload.event];
  if (!label) {
    return new Response(JSON.stringify({ ok: true, ignored: payload.event }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const buyer = payload.data?.buyer || {};
  const purchase = payload.data?.purchase || {};
  const product = payload.data?.product || {};
  const price = purchase.price?.value;
  const currency = purchase.price?.currency_value || 'BRL';

  const text = [
    `*${label}*`,
    `*Produto:* ${product.name || 'Protocolo Cliente na Porta'}`,
    `*Comprador:* ${buyer.name || 'N/A'}`,
    `*Valor:* ${currency} ${price ?? 'N/A'}`,
    `*E-mail:* ${buyer.email || 'N/A'}`,
    `*Transação:* ${purchase.transaction || 'N/A'}`
  ].join('\n');

  ctx.waitUntil(sendSlackMessage(env, text));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/hotmart-webhook') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return handleHotmartWebhook(request, env, ctx);
    }

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
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (CAPI_EVENT_TYPES[row.event_type]) {
      ctx.waitUntil(sendMetaCapi(env, {
        event_type: row.event_type,
        client_id: row.client_id,
        phone: typeof data.phone === 'string' ? data.phone : null,
        name: typeof data.name === 'string' ? data.name : null,
        fbp: typeof data.fbp === 'string' ? data.fbp : null,
        fbc: typeof data.fbc === 'string' ? data.fbc : null,
        event_id: typeof data.event_id === 'string' ? data.event_id : null,
        user_agent: row.user_agent,
        landing_url: row.landing_url
      }, request));
    }

    if (row.event_type === 'lead') {
      const leadText = [
        '📝 *Novo cadastro (WhatsApp)*',
        `*Nome:* ${typeof data.name === 'string' ? data.name : 'N/A'}`,
        `*Telefone:* ${typeof data.phone === 'string' ? data.phone : 'N/A'}`,
        `*Origem:* ${row.utm_source || 'direto'} / ${row.utm_campaign || '-'}`
      ].join('\n');
      ctx.waitUntil(sendSlackMessage(env, leadText));
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
