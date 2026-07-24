// utils/users.js
// Simple JSON-backed authorized users store.
// Format of users.json: { "users": [ { id, type, freeUsed, premiumUsed, freeLimit, premiumLimit } ] }

const fs = require('fs');
const path = require('path');
const config = require('../config.json');

const USERS_PATH = path.join(__dirname, '..', 'users.json');

function readUsers() {
    try {
        if (!fs.existsSync(USERS_PATH)) {
            fs.writeFileSync(USERS_PATH, JSON.stringify({ users: [] }, null, 4));
        }
        const raw = fs.readFileSync(USERS_PATH, 'utf-8');
        const data = JSON.parse(raw || '{"users":[]}');
        if (!Array.isArray(data.users)) data.users = [];
        return data;
    } catch (e) {
        console.error('Failed reading users.json:', e);
        return { users: [] };
    }
}

function saveUsers(data) {
    try {
        fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 4));
        return true;
    } catch (e) {
        console.error('Failed writing users.json:', e);
        return false;
    }
}

function isOwner(userId) {
    return String(userId) === String(config.ownerId);
}

function findUser(userId) {
    const data = readUsers();
    return data.users.find(u => String(u.id) === String(userId));
}

function isAuthorized(userId) {
    if (isOwner(userId)) return true;
    return !!findUser(userId);
}

function addUser(userId, type) {
    const data = readUsers();
    if (data.users.some(u => String(u.id) === String(userId))) {
        return { ok: false, reason: 'exists' };
    }
    data.users.push({
        id: String(userId),
        type: type === 'premium' ? 'premium' : 'free',
        freeUsed: 0,
        premiumUsed: 0,
        freeLimit: config.freeLimit || 5,
        premiumLimit: config.premiumLimit || 5,
    });
    saveUsers(data);
    return { ok: true };
}

function removeUser(userId) {
    const data = readUsers();
    const before = data.users.length;
    data.users = data.users.filter(u => String(u.id) !== String(userId));
    if (data.users.length === before) return { ok: false, reason: 'notfound' };
    saveUsers(data);
    return { ok: true };
}

function incrementUsage(userId, kind) {
    // kind: 'free' or 'premium'
    if (isOwner(userId)) return { ok: true, ownerBypass: true };
    const data = readUsers();
    const user = data.users.find(u => String(u.id) === String(userId));
    if (!user) return { ok: false, reason: 'not_authorized' };
    if (kind === 'free') user.freeUsed = (user.freeUsed || 0) + 1;
    else if (kind === 'premium') user.premiumUsed = (user.premiumUsed || 0) + 1;
    saveUsers(data);
    return { ok: true, user };
}

function checkLimit(userId, kind) {
    // Returns { allowed, remaining, user }
    if (isOwner(userId)) return { allowed: true, remaining: Infinity, ownerBypass: true };
    const user = findUser(userId);
    if (!user) return { allowed: false, reason: 'not_authorized' };
    if (kind === 'free') {
        const limit = user.freeLimit ?? config.freeLimit ?? 5;
        const used = user.freeUsed || 0;
        return { allowed: used < limit, remaining: Math.max(0, limit - used), user, limit };
    }
    if (kind === 'premium') {
        if (user.type !== 'premium') return { allowed: false, reason: 'premium_only', user };
        const limit = user.premiumLimit ?? config.premiumLimit ?? 5;
        const used = user.premiumUsed || 0;
        return { allowed: used < limit, remaining: Math.max(0, limit - used), user, limit };
    }
    return { allowed: false, reason: 'unknown_kind' };
}

module.exports = {
    readUsers,
    saveUsers,
    isOwner,
    isAuthorized,
    findUser,
    addUser,
    removeUser,
    incrementUsage,
    checkLimit,
};
