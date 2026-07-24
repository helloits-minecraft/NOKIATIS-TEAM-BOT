// utils/linkvertise.js
// Linkvertise Anti-Bypass integration.
// Docs: POST https://publisher.linkvertise.com/api/v1/anti_bypassing?token=<PUBLISHER_ANTI_BYPASS_TOKEN>&hash=<HASH>
// A successful (completed) link returns TRUE and consumes the hash server-side.
//
// Flow:
//   1) generateLink(userId) -> { hash, url }
//        Creates a random 64-char hash and returns a Linkvertise link that embeds it.
//        User visits and completes the link. Linkvertise stores the hash server-side.
//   2) verifyCompletion(hash) -> boolean
//        Server-to-server call to the anti-bypass endpoint. Returns true only if
//        Linkvertise confirms the hash was completed.
//
// If credentials (LINKVERTISE_PUBLISHER_ID / LINKVERTISE_ANTI_BYPASS_TOKEN) are missing,
// we throw a descriptive error so commands can fail closed (no bypass).

const crypto = require('crypto');
const config = require('../config.json');

// node-fetch v3 is ESM-only. Import dynamically to keep this file CommonJS.
async function _fetch(...args) {
    const { default: fetch } = await import('node-fetch');
    return fetch(...args);
}

function _creds() {
    const publisherId = process.env.LINKVERTISE_PUBLISHER_ID || config.LINKVERTISE_PUBLISHER_ID;
    const antiBypassToken = process.env.LINKVERTISE_ANTI_BYPASS_TOKEN || config.LINKVERTISE_ANTI_BYPASS_TOKEN;
    return { publisherId, antiBypassToken };
}

function isConfigured() {
    const { publisherId, antiBypassToken } = _creds();
    return Boolean(publisherId && antiBypassToken);
}

function _randomHash() {
    // 64-char hex string (32 bytes)
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a Linkvertise anti-bypass link for a given userId.
 * Returns { hash, url }.
 * Throws if credentials are missing.
 */
function generateLink(userId) {
    const { publisherId, antiBypassToken } = _creds();
    if (!publisherId || !antiBypassToken) {
        const missing = [];
        if (!publisherId) missing.push('LINKVERTISE_PUBLISHER_ID');
        if (!antiBypassToken) missing.push('LINKVERTISE_ANTI_BYPASS_TOKEN');
        throw new Error(`Linkvertise is not configured. Missing: ${missing.join(', ')}. Set them in config.json or environment variables.`);
    }
    const hash = _randomHash();
    // Standard Linkvertise link-hub URL pattern with anti-bypass hash.
    const url = `https://link-hub.net/${encodeURIComponent(publisherId)}/${hash}`;
    return { hash, url, userId: String(userId) };
}

/**
 * Verify link completion by asking Linkvertise's anti-bypass endpoint.
 * Returns true only if Linkvertise confirms the hash was completed.
 * On any network / config error, returns false (fail closed – never bypass).
 */
async function verifyCompletion(hash) {
    if (!hash || typeof hash !== 'string') return false;
    const { antiBypassToken } = _creds();
    if (!antiBypassToken) return false;

    const endpoint = `https://publisher.linkvertise.com/api/v1/anti_bypassing`
        + `?token=${encodeURIComponent(antiBypassToken)}`
        + `&hash=${encodeURIComponent(hash)}`;
    try {
        const res = await _fetch(endpoint, { method: 'POST' });
        const text = (await res.text()).trim();
        // API returns literal "TRUE" (or true) on success, otherwise something falsy / FALSE.
        if (!res.ok) return false;
        if (/^true$/i.test(text)) return true;
        try {
            const json = JSON.parse(text);
            if (json === true) return true;
            if (json && (json.success === true || json.valid === true || json.status === true)) return true;
        } catch (_) { /* not JSON */ }
        return false;
    } catch (e) {
        console.error('Linkvertise verifyCompletion error:', e && e.message ? e.message : e);
        return false;
    }
}

module.exports = {
    isConfigured,
    generateLink,
    verifyCompletion,
};
