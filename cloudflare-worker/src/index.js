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

  try {
    await env.DB.prepare(`
      INSERT INTO hotmart_events
        (event_type, transaction_id, product_name, buyer_name, buyer_email, price, currency, raw_payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      payload.event,
      purchase.transaction || null,
      product.name || null,
      buyer.name || null,
      buyer.email || null,
      price ?? null,
      currency,
      JSON.stringify(payload).slice(0, 8000),
      new Date().toISOString()
    ).run();
  } catch (_) {
    // não bloqueia a notificação do Slack se a gravação falhar
  }

  ctx.waitUntil(sendSlackMessage(env, text));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

const EVENT_LABELS = {
  pageview: 'Visualizações de página',
  hero_cta_click: 'Clique no CTA (hero)',
  checkout_click: 'Iniciar checkout',
  whatsapp_click: 'Abriu WhatsApp',
  lead: 'Cadastro (Lead)'
};

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleDashboardData(request, env) {
  if (!env.DASHBOARD_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'DASHBOARD_KEY não configurada (wrangler secret put DASHBOARD_KEY)' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const key = request.headers.get('x-dashboard-key') || new URL(request.url).searchParams.get('key');
  if (key !== env.DASHBOARD_KEY) return unauthorized();

  const [totals, byDay, bySource, byPage, recent, salesLatest, salesByDay] = await Promise.all([
    env.DB.prepare(`
      SELECT event_type, COUNT(*) AS total, COUNT(DISTINCT client_id) AS uniques
      FROM tracking_events GROUP BY event_type
    `).all(),
    env.DB.prepare(`
      SELECT substr(created_at,1,10) AS day, event_type, COUNT(*) AS total
      FROM tracking_events
      WHERE created_at >= datetime('now','-30 days')
      GROUP BY day, event_type ORDER BY day
    `).all(),
    env.DB.prepare(`
      SELECT COALESCE(utm_source,'(direto)') AS source, COALESCE(utm_campaign,'(nenhuma)') AS campaign,
             event_type, COUNT(*) AS total, COUNT(DISTINCT client_id) AS uniques
      FROM tracking_events GROUP BY source, campaign, event_type
    `).all(),
    env.DB.prepare(`
      SELECT CASE WHEN landing_url LIKE '%live-avcb%' THEN 'live-avcb' ELSE 'index' END AS page,
             event_type, COUNT(*) AS total, COUNT(DISTINCT client_id) AS uniques
      FROM tracking_events GROUP BY page, event_type
    `).all(),
    env.DB.prepare(`
      SELECT event_type, utm_source, utm_campaign, gclid, fbclid, landing_url, created_at
      FROM tracking_events ORDER BY created_at DESC LIMIT 50
    `).all(),
    env.DB.prepare(`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY transaction_id ORDER BY created_at DESC) AS rn
        FROM hotmart_events WHERE transaction_id IS NOT NULL
      )
      SELECT event_type, transaction_id, product_name, buyer_name, price, currency, created_at
      FROM ranked WHERE rn = 1 ORDER BY created_at DESC
    `).all(),
    env.DB.prepare(`
      SELECT substr(created_at,1,10) AS day, event_type, COUNT(*) AS total, SUM(price) AS revenue
      FROM hotmart_events
      WHERE created_at >= datetime('now','-30 days')
      GROUP BY day, event_type ORDER BY day
    `).all()
  ]);

  return new Response(JSON.stringify({
    ok: true,
    labels: EVENT_LABELS,
    hotmart_labels: HOTMART_EVENT_LABELS,
    totals: totals.results,
    by_day: byDay.results,
    by_source: bySource.results,
    by_page: byPage.results,
    recent: recent.results,
    sales_latest: salesLatest.results,
    sales_by_day: salesByDay.results
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function dashboardHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard · Ads sem Agência</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0b0d12; color:#e6e8ec; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8b93a1; font-size: 13px; margin-bottom: 24px; }
  #gate { max-width: 320px; margin: 80px auto; text-align:center; }
  #gate input { width:100%; padding:10px 12px; border-radius:8px; border:1px solid #2a2f3a; background:#151822; color:#e6e8ec; font-size:14px; margin-top:12px; }
  #gate button { width:100%; margin-top:10px; padding:10px; border-radius:8px; border:none; background:#f97316; color:#fff; font-weight:700; cursor:pointer; }
  #app { display:none; }
  .cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap:12px; margin-bottom: 28px; }
  .card { background:#151822; border:1px solid #232733; border-radius:10px; padding:14px 16px; }
  .card .n { font-size: 24px; font-weight: 800; }
  .card .l { font-size: 12px; color:#8b93a1; margin-top:2px; }
  .card .u { font-size: 11px; color:#5c6470; margin-top:4px; }
  section { margin-bottom: 32px; }
  section h2 { font-size: 14px; text-transform: uppercase; letter-spacing:.04em; color:#8b93a1; margin-bottom: 12px; }
  .funnel-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; font-size:13px; }
  .funnel-label { width: 170px; flex-shrink:0; color:#c3c8d1; }
  .funnel-bar-wrap { flex:1; background:#151822; border-radius:6px; overflow:hidden; height: 22px; }
  .funnel-bar { height:100%; background:linear-gradient(90deg,#f97316,#ea580c); }
  .funnel-pct { width: 60px; text-align:right; color:#8b93a1; flex-shrink:0; }
  table { width:100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align:left; padding: 8px 10px; border-bottom: 1px solid #1c2029; white-space: nowrap; }
  th { color:#8b93a1; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.03em; }
  tr:hover td { background:#12151d; }
  .scroll { overflow-x:auto; border:1px solid #232733; border-radius:10px; }
  .empty { color:#5c6470; font-size:13px; padding:16px; }
  .err { color:#f87171; font-size:13px; margin-top:10px; }
</style>
</head>
<body>
  <div id="gate">
    <h1>Dashboard de Tracking</h1>
    <div class="sub">Ads sem Agência</div>
    <input id="key-input" type="password" placeholder="Chave de acesso" />
    <button id="key-btn">Entrar</button>
    <div id="gate-err" class="err"></div>
  </div>

  <div id="app">
    <h1>Dashboard de Tracking</h1>
    <div class="sub">Dados em tempo real do banco D1 (sem sampling, sem bloqueio por ad blocker)</div>

    <div class="cards" id="cards"></div>

    <section>
      <h2>Vendas (Hotmart)</h2>
      <div class="cards" id="sales-cards"></div>
      <div class="scroll"><table id="tbl-sales"></table></div>
    </section>

    <section>
      <h2>Funil (% sobre pageviews)</h2>
      <div id="funnel"></div>
    </section>

    <section>
      <h2>Por página</h2>
      <div class="scroll"><table id="tbl-page"></table></div>
    </section>

    <section>
      <h2>Por origem (UTM source / campanha)</h2>
      <div class="scroll"><table id="tbl-source"></table></div>
    </section>

    <section>
      <h2>Últimos 30 dias</h2>
      <div class="scroll"><table id="tbl-day"></table></div>
    </section>

    <section>
      <h2>Eventos recentes</h2>
      <div class="scroll"><table id="tbl-recent"></table></div>
    </section>
  </div>

<script>
(function() {
  var LS_KEY = '_dash_key';

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  function pivot(rows, rowKeyFn, colKey, valKey) {
    var rowMap = {}, cols = {};
    rows.forEach(function(r) {
      var rk = rowKeyFn(r);
      if (!rowMap[rk]) rowMap[rk] = {};
      rowMap[rk][r[colKey]] = r[valKey];
      cols[r[colKey]] = true;
    });
    return { rowMap: rowMap, cols: Object.keys(cols) };
  }

  function renderPivotTable(el, rows, rowKeyFn, rowLabelFn, colKey, valKey, labels) {
    var p = pivot(rows, rowKeyFn, colKey, valKey);
    var colOrder = Object.keys(labels).filter(function(c){ return p.cols.indexOf(c) !== -1; })
      .concat(p.cols.filter(function(c){ return Object.keys(labels).indexOf(c) === -1; }));
    var head = '<tr><th>Grupo</th>' + colOrder.map(function(c){ return '<th>' + esc(labels[c] || c) + '</th>'; }).join('') + '</tr>';
    var rowKeys = Object.keys(p.rowMap);
    if (!rowKeys.length) { el.parentElement.innerHTML = '<div class="empty">Sem dados ainda.</div>'; return; }
    var body = rowKeys.map(function(rk) {
      return '<tr><td>' + esc(rowLabelFn(rk)) + '</td>' + colOrder.map(function(c) {
        return '<td>' + (p.rowMap[rk][c] || 0) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    el.innerHTML = head + body;
  }

  function load(key) {
    fetch('/api/dashboard-data', { headers: { 'x-dashboard-key': key } })
      .then(function(r) { if (!r.ok) throw new Error(r.status === 401 ? 'Chave inválida' : 'Erro ao carregar dados'); return r.json(); })
      .then(function(data) {
        try { localStorage.setItem(LS_KEY, key); } catch(_) {}
        document.getElementById('gate').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        render(data);
      })
      .catch(function(err) {
        document.getElementById('gate-err').textContent = err.message;
      });
  }

  function render(data) {
    var labels = data.labels;
    var totalsByType = {};
    data.totals.forEach(function(t) { totalsByType[t.event_type] = t; });
    var pageviews = (totalsByType.pageview && totalsByType.pageview.total) || 0;

    // Cards
    var order = ['pageview','hero_cta_click','checkout_click','whatsapp_click','lead'];
    var cardsHtml = order.map(function(k) {
      var t = totalsByType[k] || { total: 0, uniques: 0 };
      return '<div class="card"><div class="n">' + t.total + '</div><div class="l">' + esc(labels[k] || k) + '</div><div class="u">' + t.uniques + ' visitantes únicos</div></div>';
    }).join('');
    document.getElementById('cards').innerHTML = cardsHtml;

    // Vendas (Hotmart)
    var hotmartLabels = data.hotmart_labels || {};
    var salesLatest = data.sales_latest || [];
    var POSITIVE = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'];
    var approved = salesLatest.filter(function(s){ return POSITIVE.indexOf(s.event_type) !== -1; });
    var refunded = salesLatest.filter(function(s){ return s.event_type === 'PURCHASE_REFUNDED'; });
    var chargeback = salesLatest.filter(function(s){ return s.event_type === 'PURCHASE_CHARGEBACK'; });
    var revenue = approved.reduce(function(sum, s){ return sum + (s.price || 0); }, 0);
    var currency = (approved[0] && approved[0].currency) || 'BRL';
    var salesCardsHtml = [
      '<div class="card"><div class="n">' + approved.length + '</div><div class="l">Vendas aprovadas</div></div>',
      '<div class="card"><div class="n">' + currency + ' ' + revenue.toFixed(2) + '</div><div class="l">Receita</div></div>',
      '<div class="card"><div class="n">' + refunded.length + '</div><div class="l">Reembolsos</div></div>',
      '<div class="card"><div class="n">' + chargeback.length + '</div><div class="l">Chargebacks</div></div>'
    ].join('');
    document.getElementById('sales-cards').innerHTML = salesCardsHtml;

    var salesEl = document.getElementById('tbl-sales');
    if (!salesLatest.length) {
      salesEl.parentElement.innerHTML = '<div class="empty">Sem vendas ainda. Assim que a Hotmart enviar o primeiro webhook, aparece aqui.</div>';
    } else {
      salesEl.innerHTML = '<tr><th>Quando</th><th>Status</th><th>Produto</th><th>Comprador</th><th>Valor</th></tr>' +
        salesLatest.slice(0, 30).map(function(s) {
          return '<tr><td>' + esc(s.created_at) + '</td><td>' + esc(hotmartLabels[s.event_type] || s.event_type) + '</td><td>' +
            esc(s.product_name || '—') + '</td><td>' + esc(s.buyer_name || '—') + '</td><td>' +
            esc(s.currency || '') + ' ' + (s.price != null ? Number(s.price).toFixed(2) : '—') + '</td></tr>';
        }).join('');
    }

    // Funnel
    var funnelHtml = order.filter(function(k){ return k !== 'pageview'; }).map(function(k) {
      var t = totalsByType[k] || { total: 0 };
      var pct = pageviews ? Math.round((t.total / pageviews) * 1000) / 10 : 0;
      return '<div class="funnel-row"><div class="funnel-label">' + esc(labels[k] || k) + '</div>' +
        '<div class="funnel-bar-wrap"><div class="funnel-bar" style="width:' + Math.min(pct,100) + '%"></div></div>' +
        '<div class="funnel-pct">' + pct + '%</div></div>';
    }).join('');
    document.getElementById('funnel').innerHTML = funnelHtml || '<div class="empty">Sem dados ainda.</div>';

    // Por página
    renderPivotTable(document.getElementById('tbl-page'), data.by_page,
      function(r){ return r.page; }, function(rk){ return rk; }, 'event_type', 'total', labels);

    // Por origem
    renderPivotTable(document.getElementById('tbl-source'), data.by_source,
      function(r){ return r.source + ' / ' + r.campaign; },
      function(rk){ return rk; }, 'event_type', 'total', labels);

    // Por dia
    renderPivotTable(document.getElementById('tbl-day'), data.by_day,
      function(r){ return r.day; }, function(rk){ return rk; }, 'event_type', 'total', labels);

    // Recentes
    var recentRows = data.recent;
    var recentEl = document.getElementById('tbl-recent');
    if (!recentRows.length) {
      recentEl.parentElement.innerHTML = '<div class="empty">Sem eventos ainda.</div>';
    } else {
      recentEl.innerHTML = '<tr><th>Quando</th><th>Evento</th><th>Origem</th><th>Campanha</th><th>Clique Ads</th><th>Página</th></tr>' +
        recentRows.map(function(r) {
          var adClick = r.gclid ? 'Google' : (r.fbclid ? 'Meta' : '—');
          var page = (r.landing_url || '').indexOf('live-avcb') !== -1 ? 'live-avcb' : 'index';
          return '<tr><td>' + esc(r.created_at) + '</td><td>' + esc(labels[r.event_type] || r.event_type) + '</td><td>' +
            esc(r.utm_source || '(direto)') + '</td><td>' + esc(r.utm_campaign || '—') + '</td><td>' + adClick + '</td><td>' + page + '</td></tr>';
        }).join('');
    }
  }

  document.getElementById('key-btn').addEventListener('click', function() {
    var key = document.getElementById('key-input').value.trim();
    if (key) load(key);
  });
  document.getElementById('key-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('key-btn').click();
  });

  var saved;
  try { saved = localStorage.getItem(LS_KEY); } catch(_) {}
  if (saved) load(saved);
})();
</script>
</body>
</html>`;
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

    if (url.pathname === '/api/dashboard') {
      return new Response(dashboardHtml(), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/api/dashboard-data') {
      return handleDashboardData(request, env);
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
