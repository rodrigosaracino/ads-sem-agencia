// ─── TRACKING: client ID + UTMs + Click IDs ───────────────────────────────
const BASE_HOTMART = 'https://pay.hotmart.com/A106251122L';
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
    TRACK_KEYS.forEach(k => { const v = p.get(k); if (v) merged[k] = v; });
    try { localStorage.setItem('_track', JSON.stringify(merged)); } catch (_) {}
    return merged;
}
const TRACKING = captureTrackingParams();

function getCookie(name) {
    const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? m.pop() : null;
}

function buildFbc() {
    return TRACKING.fbclid ? `fb.1.${Date.now()}.${TRACKING.fbclid}` : null;
}

function buildHotmartUrl() {
    const extra = Object.entries(TRACKING)
        .filter(([, v]) => v)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    return extra ? `${BASE_HOTMART}&${extra}` : BASE_HOTMART;
}

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
            fbp: getCookie('_fbp'),
            ...(extra || {})
        })
    }).catch(() => {});
}

// ─── CONVERSÕES ───────────────────────────────────────────────────────────
function fireCheckoutConversion() {
    const eventId = 'checkout_' + CLIENT_ID + '_' + Date.now();
    if (typeof fbq !== 'undefined') {
        fbq('track', 'InitiateCheckout', {
            currency: 'BRL', value: 397.00,
            content_name: 'Protocolo Cliente na Porta',
            content_type: 'product'
        }, { eventID: eventId });
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
    sendTrackingPing('checkout_click', { event_id: eventId, fbc: buildFbc() });
}

function toE164BR(telefone) {
    const digits = (telefone || '').replace(/\D/g, '');
    if (!digits) return null;
    return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
}

function fireLeadConversion(nome, telefone) {
    const eventId = 'lead_' + CLIENT_ID + '_' + Date.now();
    if (typeof fbq !== 'undefined') {
        fbq('track', 'Lead', { content_name: 'Protocolo Cliente na Porta' }, { eventID: eventId });
    }
    if (typeof gtag !== 'undefined') {
        const phoneE164 = toE164BR(telefone);
        if (phoneE164) gtag('set', 'user_data', { phone_number: phoneE164 });
        gtag('event', 'conversion', {
            'send_to': 'AW-479406830/d196CM7yhMIcEO7VzOQB',
            'value': 1.0,
            'currency': 'BRL'
        });
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'whatsapp_form_submit', user_name: nome });
    sendTrackingPing('lead', { phone: telefone, name: nome, event_id: eventId, fbc: buildFbc() });
}

// ─── DOM PRONTO ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // Pageview no backend
    sendTrackingPing('pageview');

    // Headline dinâmica para campanha de advogados
    if (new URLSearchParams(window.location.search).get('utm_campaign') === 'advogados') {
        const h = document.getElementById('main-headline');
        const s = document.getElementById('main-subheadline');
        if (h) h.innerHTML = `Advogados: Apareça no Google Quando Seu Cliente Está <span class="text-orange-500">Procurando um Advogado Agora</span>`;
        if (s) s.innerHTML = `Sem pagar <strong class="text-orange-400">R$&nbsp;1.500 a R$&nbsp;2.500 por mês</strong> para agência — ative sua campanha hoje e receba o primeiro contato de cliente no WhatsApp nas primeiras 24 horas.`;
    }

    // Injeta UTMs nos links da Hotmart e conecta fireCheckoutConversion
    const hotmartUrl = buildHotmartUrl();
    document.querySelectorAll('a[href*="pay.hotmart.com"], a#vsl-cta-link').forEach(link => {
        link.href = hotmartUrl;
        link.addEventListener('click', fireCheckoutConversion);
    });

    // Scroll âncora do CTA hero
    const heroCtaScroll = document.getElementById('vsl-cta');
    if (heroCtaScroll) {
        heroCtaScroll.addEventListener('click', e => {
            e.preventDefault();
            const target = document.getElementById('oferta');
            if (target) target.scrollIntoView({ behavior: 'smooth' });
            window.dataLayer = window.dataLayer || [];
            window.dataLayer.push({ event: 'hero_cta_click' });
        });
    }

    // Modal WhatsApp
    const modal   = document.getElementById('whatsapp-modal');
    const openBtn = document.getElementById('floating-wa-btn');
    const closeBtn = document.getElementById('close-modal-btn');
    const waForm  = document.getElementById('whatsapp-lead-form');

    function openModal() {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'whatsapp_click' });
        if (modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    }
    function closeModal() {
        if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
    }

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    // Máscara de telefone
    const phoneInput = document.getElementById('form-phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', function() {
            const d = this.value.replace(/\D/g, '').slice(0, 11);
            if (d.length <= 2) this.value = d;
            else if (d.length <= 6) this.value = `(${d.slice(0,2)}) ${d.slice(2)}`;
            else if (d.length <= 10) this.value = `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
            else this.value = `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
        });
    }

    // Submit do formulário
    if (waForm) {
        waForm.addEventListener('submit', async e => {
            e.preventDefault();
            const nome     = document.getElementById('form-name').value.trim();
            const telefone = document.getElementById('form-phone').value.trim();
            const submitBtn = waForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.textContent = 'Abrindo WhatsApp...';

            // Conversões
            fireLeadConversion(nome, telefone);

            // n8n
            fetch('https://n8n.amzcursos.com/webhook/5a78888a-5999-4e65-8dae-14d8fe25f052', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nome, whatsapp: telefone,
                    source: 'whatsapp_modal',
                    client_id: CLIENT_ID,
                    ...TRACKING,
                    data_conversao: new Date().toISOString(),
                    url_origem: window.location.href
                })
            }).catch(() => {});

            // Dashboard
            fetch('https://dash.amzcursos.com/api/public/lead', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nome, phone: telefone, source: 'landing_page_whatsapp' })
            }).catch(() => {});

            const msg = encodeURIComponent(`Olá Rodrigo! Me chamo ${nome} e tenho interesse no Protocolo Cliente na Porta. Pode me dar mais informações?`);
            window.open(`https://wa.me/5511962650342?text=${msg}`, '_blank');
            closeModal();
        });
    }
});

// ─── VSL — YouTube IFrame API (lazy: só carrega quando usuário clica em play) ─
let ytPlayer;
let ctaTimerInterval;

function initYTPlayer() {
    if (ytPlayer) return;
    ytPlayer = new YT.Player('yt-vsl-player', {
        videoId: 'qTW2aZLogkY',
        width: 1280,
        height: 720,
        playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            rel: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            fs: 0,
            playsinline: 1,
            cc_load_policy: 0,
        },
        events: {
            onReady: function(ev) {
                const iframe = ev.target.getIframe();
                Object.assign(iframe.style, {
                    position: 'absolute', top: '0', left: '0',
                    width: '100%', height: '100%', border: 'none'
                });
                try { ev.target.setPlaybackQuality('hd720'); } catch(_) {}
                ev.target.playVideo();
                // Esconde overlay ao iniciar
                const overlay = document.getElementById('vsl-overlay');
                if (overlay) overlay.style.display = 'none';
            },
            onStateChange: function(ev) {
                if (ev.data === YT.PlayerState.PLAYING && !ctaTimerInterval) {
                    ctaTimerInterval = setInterval(function() {
                        if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                            if (ytPlayer.getCurrentTime() >= 360) {
                                // Mostra CTA sobreposto ao vídeo
                                const videoCta = document.getElementById('vsl-video-cta');
                                if (videoCta) videoCta.style.display = 'block';
                                clearInterval(ctaTimerInterval);
                                ctaTimerInterval = null;
                            }
                        }
                    }, 2000);
                }
            }
        }
    });
}

function loadYouTubeAPI() {
    if (window.YT && window.YT.Player) {
        initYTPlayer();
        return;
    }
    window.onYouTubeIframeAPIReady = initYTPlayer;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
}

// Dispara lazy load ao clicar no overlay
document.addEventListener('DOMContentLoaded', function() {
    const overlay = document.getElementById('vsl-overlay');
    if (overlay) overlay.addEventListener('click', loadYouTubeAPI);
});
