// Tests 2FA : activation, connexion en 2 étapes, rejeu, codes de secours, désactivation, réinitialisation admin
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const T = require('../totp.js');
const PORT = 4200 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}/api`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm3-')); let srv, tok = '', secret = '', recovery = [];
const call = async (m, u, b, t = tok) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, d: await r.json().catch(() => ({})) }; };
const PW = 'motdepasse-solide-1', now = (k = 0) => Date.now() + k * 30000;
before(async () => {
  srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DB_FILE: path.join(tmp, 't.sqlite'), JWT_SECRET: 'test-secret-test-secret-test-secret' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
  await call('POST', '/setup/admin', { name: 'Admin', email: 'a@x.ma', password: PW }); tok = (await call('POST', '/auth/login', { email: 'a@x.ma', password: PW })).d.token;
});
after(async () => { if (srv) await new Promise(r => { srv.once('exit', r); srv.kill(); }); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); });

test('activation : QR + clé, mauvais code refusé, bon code accepté, 10 codes de secours', async () => {
  assert.equal((await call('GET', '/me/2fa')).d.enabled, false);
  const s = await call('POST', '/me/2fa/setup', {}); assert.equal(s.s, 200); assert.match(s.d.qr, /^data:image\/png;base64,/); assert.match(s.d.uri, /^otpauth:\/\/totp\//); secret = s.d.secret.replace(/\s/g, '');
  assert.equal((await call('POST', '/me/2fa/enable', { code: '000000' })).s, 400);
  const e = await call('POST', '/me/2fa/enable', { code: T.code(secret, now()) }); assert.equal(e.s, 200); assert.equal(e.d.recoveryCodes.length, 10); recovery = e.d.recoveryCodes; assert.match(recovery[0], /^[0-9A-F]{6}-[0-9A-F]{6}$/);
  assert.equal((await call('GET', '/me/2fa')).d.recoveryLeft, 10);
});
test('connexion en 2 étapes : pas de session sans code, challenge inutilisable comme jeton', async () => {
  const l = await call('POST', '/auth/login', { email: 'a@x.ma', password: PW }, ''); assert.equal(l.d.needs2fa, true); assert.equal(l.d.token, undefined); const ch = l.d.challenge;
  assert.equal((await call('GET', '/companies', null, ch)).s, 401, 'le challenge ne donne aucun accès');
  assert.equal((await call('POST', '/auth/2fa', { challenge: ch, code: '123456' }, '')).s, 401);
  const ok = await call('POST', '/auth/2fa', { challenge: ch, code: T.code(secret, now(1)) }, ''); assert.equal(ok.s, 200); assert.ok(ok.d.token); tok = ok.d.token;
  assert.equal((await call('GET', '/companies')).s, 200);
  const l2 = await call('POST', '/auth/login', { email: 'a@x.ma', password: PW }, ''), replay = await call('POST', '/auth/2fa', { challenge: l2.d.challenge, code: T.code(secret, now(1)) }, ''); assert.equal(replay.s, 401, 'même code réutilisé = refusé');
  assert.equal((await call('POST', '/auth/2fa', { challenge: 'x.y.z', code: '111111' }, '')).s, 401);
});
test('codes de secours : usage unique', async () => {
  const l = await call('POST', '/auth/login', { email: 'a@x.ma', password: PW }, ''), r = await call('POST', '/auth/2fa', { challenge: l.d.challenge, code: recovery[0].toLowerCase() }, ''); assert.equal(r.s, 200); assert.equal(r.d.usedRecovery, true); assert.equal(r.d.recoveryLeft, 9);
  const l2 = await call('POST', '/auth/login', { email: 'a@x.ma', password: PW }, ''); assert.equal((await call('POST', '/auth/2fa', { challenge: l2.d.challenge, code: recovery[0] }, '')).s, 401, 'déjà utilisé');
});
test('désactivation exige mot de passe + code ; réinitialisation par admin', async () => {
  assert.equal((await call('POST', '/me/2fa/disable', { password: 'faux', code: recovery[1] })).s, 401);
  assert.equal((await call('POST', '/me/2fa/disable', { password: PW, code: '000000' })).s, 401);
  const u = (await call('POST', '/users', { name: 'Bob', email: 'b@x.ma', password: 'bob-mot-de-passe-1' })).d.id; assert.equal((await call('POST', `/users/${u}/2fa/reset`, {})).s, 200);
  assert.equal((await call('POST', '/me/2fa/disable', { password: PW, code: recovery[1] })).s, 200, 'un code de secours valide aussi');
  assert.equal((await call('GET', '/me/2fa')).d.enabled, false); assert.ok((await call('POST', '/auth/login', { email: 'a@x.ma', password: PW }, '')).d.token, 'connexion directe à nouveau');
});
test('verrouillage après 5 codes faux', async () => {
  const s = (await call('POST', '/me/2fa/setup', {})).d; secret = s.secret.replace(/\s/g, ''); await call('POST', '/me/2fa/enable', { code: T.code(secret, now()) });
  const ch = (await call('POST', '/auth/login', { email: 'a@x.ma', password: PW }, '')).d.challenge; let last;
  for (let i = 0; i < 5; i++) last = await call('POST', '/auth/2fa', { challenge: ch, code: '999999' }, ''); assert.equal(last.s, 401);
  const blocked = await call('POST', '/auth/2fa', { challenge: ch, code: T.code(secret, now(1)) }, ''); assert.equal(blocked.s, 429, 'même le bon code est bloqué pendant 15 min');
});
