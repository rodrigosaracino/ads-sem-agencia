// ─── TRACKING CORE: client ID + UTMs + Click IDs + ping para /api/track ───
// Compartilhado entre index.html e live-avcb.html. Carregar antes de qualquer
// script que dispare conversões (app.js ou inline).
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

document.addEventListener('DOMContentLoaded', () => {
    sendTrackingPing('pageview');
});
