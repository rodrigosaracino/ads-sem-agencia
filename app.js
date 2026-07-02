// ─── PARÂMETROS E CAPTURA DE TRACKING DE PARÂMETROS ───
const BASE_HOTMART = 'https://pay.hotmart.com/Y104360494V?off=av71abb8';
const TRACK_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'gclid', 'fbclid'];

function getOrCreateClientId() {
    try {
        let id = localStorage.getItem('_cid');
        if (!id) {
            id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem('_cid', id);
        }
        return id;
    } catch (_) { return 'na'; }
}
const CLIENT_ID = getOrCreateClientId();

function captureTrackingParams() {
    const p = new URLSearchParams(window.location.search);
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('_track') || '{}'); } catch (_) {}
    const merged = { ...stored };
    TRACK_KEYS.forEach(k => {
        const v = p.get(k);
        if (v) merged[k] = v;
    });
    try { localStorage.setItem('_track', JSON.stringify(merged)); } catch (_) {}
    return merged;
}
const TRACKING = captureTrackingParams();

function buildHotmartUrl() {
    const extra = Object.entries(TRACKING)
        .filter(([, v]) => v)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    return extra ? `${BASE_HOTMART}&${extra}` : BASE_HOTMART;
}

// ─── DISPARO DE EVENTOS / CONVERSÕES ───
function sendTrackingPing(eventType, extra) {
    fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            event_type: eventType,
            ...TRACKING,
            referrer: document.referrer || null,
            user_agent: navigator.userAgent,
            landing_url: window.location.href,
            ...(extra || {})
        })
    }).catch(() => {});
}

function fireCheckoutConversion() {
    if (typeof fbq !== 'undefined') {
        fbq('track', 'InitiateCheckout', {
            currency: 'BRL', value: 397.00,
            content_name: 'Protocolo Cliente na Porta',
            content_type: 'product'
        });
    }
    if (typeof gtag !== 'undefined') {
        gtag('event', 'conversion', {
            'send_to': 'AW-479406830/CHECKOUT_LABEL',
            'value': 397.00,
            'currency': 'BRL'
        });
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'checkout_click', value: 397.00, currency: 'BRL' });
    sendTrackingPing('checkout_click');
}

// ─── REESCRITA DINÂMICA (CAMPANHA ADVOGADOS) ───
const currentCampaign = new URLSearchParams(window.location.search).get('utm_campaign');
if (currentCampaign === 'advogados') {
    const headline = document.getElementById('main-headline');
    const subheadline = document.getElementById('main-subheadline');
    if (headline) {
        headline.innerHTML = `Advogados: Apareça no Google Quando Seu Cliente Está <span class="text-orange-500">Procurando um Advogado Agora</span>`;
    }
    if (subheadline) {
        subheadline.innerHTML = `Sem pagar <strong class="text-orange-400">R$&nbsp;1.500 a R$&nbsp;2.500 por mês</strong> para agência — ative sua campanha hoje e receba o primeiro contato de cliente no WhatsApp nas primeiras 24 horas.`;
    }
}

// Injeta as URLs dinâmicas e monitora cliques nos CTAs de Compra
document.querySelectorAll('a').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href.includes('pay.hotmart.com') || href === '#oferta') {
        if (href.includes('pay.hotmart.com')) {
            link.href = buildHotmartUrl();
        }
        link.addEventListener('click', (e) => {
            if (link.getAttribute('href') !== '#oferta') {
                fireCheckoutConversion();
            } else {
                e.preventDefault();
                document.getElementById('oferta').scrollIntoView({ behavior: 'smooth' });
                window.dataLayer = window.dataLayer || [];
                window.dataLayer.push({'event': 'hero_cta_click'});
            }
        });
    }
});

// ─── CONTROLE DO POPUP DO WHATSAPP ───
const modal = document.getElementById('whatsapp-modal');
const openBtn = document.getElementById('floating-wa-btn');
const closeBtn = document.getElementById('close-modal-btn');
const waForm = document.getElementById('whatsapp-lead-form');

if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({'event': 'whatsapp_click'});
        modal.style.display = 'flex';
    });
}
if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
}

// Submissão do formulário de Lead
if (waForm) {
    waForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('form-name').value;
        const telefone = document.getElementById('form-phone').value;

        // Disparos do Pixel / Google Ads
        if (typeof fbq !== 'undefined') {
            fbq('track', 'Lead', { content_name: 'Protocolo Cliente na Porta' });
        }
        if (typeof gtag !== 'undefined') {
            gtag('event', 'conversion', {
                'send_to': 'AW-479406830/d196CM7yhMIcEO7VzOQB',
                'value': 1.0,
                'currency': 'BRL'
            });
        }
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'whatsapp_form_submit', user_name: nome });

        // Envio para Webhooks (n8n e Dashboard)
        const payload = { nome, whatsapp: telefone, source: 'static_lp', ...TRACKING };
        fetch('https://sua-url-n8n.com', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {});

        // Redirecionamento Final para wa.me
        const msg = encodeURIComponent(`Olá Rodrigo! Me chamo ${nome} e tenho interesse no Protocolo Cliente na Porta.`);
        window.open(`https://wa.me/5511962650342?text=${msg}`, '_blank');
        modal.style.display = 'none';
    });
}

// ─── CONTROLE DA VSL (YOUTUBE PLAYER API) ───
let player;
const ctaBtn = document.getElementById('vsl-cta');
if (ctaBtn) ctaBtn.style.display = 'none'; // Começa escondido de forma intencional se configurado

window.onYouTubeIframeAPIReady = function() {
    player = new YT.Player('yt-vsl-player', {
        height: '100%',
        width: '100%',
        videoId: 'qTW2aZLogkY',
        playerVars: {
            'autoplay': 0, 'controls': 0, 'disablekb': 1, 'rel': 0, 'modestbranding': 1, 'fs': 0, 'playsinline': 1
        },
        events: {
            'onStateChange': onPlayerStateChange
        }
    });
};

let checkInterval;
function onPlayerStateChange(event) {
    const overlay = document.getElementById('vsl-overlay');
    if (event.data === YT.PlayerState.PLAYING) {
        if (overlay) overlay.style.display = 'none';
        if (!checkInterval) {
            checkInterval = setInterval(() => {
                if (player && typeof player.getCurrentTime === 'function') {
                    // EXATOS 120 SEGUNDOS (2 MINUTOS) PARA LIBERAR O BOTÃO NA REDE DE BUSCA
                    if (player.getCurrentTime() >= 120) {
                        if (ctaBtn) ctaBtn.style.display = 'block';
                        clearInterval(checkInterval);
                    }
                }
            }, 1000);
        }
    }
}

const vslOverlay = document.getElementById('vsl-overlay');
if (vslOverlay) {
    vslOverlay.addEventListener('click', () => { if (player) player.playVideo(); });
}

// Envia pageview nativo via API de track própria
sendTrackingPing('pageview');