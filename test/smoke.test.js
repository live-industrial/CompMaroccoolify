// Test de bout en bout : démarre le serveur sur une base temporaire et vérifie le flux comptable complet.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}/api`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-')); let srv, T = '', C = 0;
const call = async (m, u, b, tok = T) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, d: await r.json().catch(() => ({})) }; };
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DB_FILE: path.join(tmp, 't.sqlite'), JWT_SECRET: 'test-secret-test-secret-test-secret' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); }
  throw Error('Serveur non démarré');
});
after(async () => { if (srv) await new Promise(r => { srv.once('exit', r); srv.kill(); }); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); });

test('installation, connexion et dossier', async () => {
  assert.equal((await call('POST', '/setup/admin', { name: 'Admin', email: 'a@x.ma', password: 'motdepasse-solide-1' })).s, 200);
  assert.equal((await call('POST', '/auth/login', { email: 'a@x.ma', password: 'faux' })).s, 401);
  T = (await call('POST', '/auth/login', { email: 'a@x.ma', password: 'motdepasse-solide-1' })).d.token; assert.ok(T);
  C = (await call('POST', '/companies', { name: 'Atlas SARL' })).d.id; assert.ok(C);
});

let cli, four, inv;
test('facture de vente : calcul, numéro auto, écriture automatique équilibrée', async () => {
  cli = (await call('POST', `/third-parties?companyId=${C}`, { kind: 'CLIENT', name: 'Client A' })).d.id;
  four = (await call('POST', `/third-parties?companyId=${C}`, { kind: 'FOURNISSEUR', name: 'Fourn B' })).d.id;
  const r = await call('POST', `/invoices?companyId=${C}`, { partyId: cli, kind: 'VENTE', date: today, lines: [{ description: 'A', quantity: '3', unitPrice: '33.33', taxRate: '20' }, { description: 'B', quantity: '1', unitPrice: '100', taxRate: '10' }] });
  assert.equal(r.s, 201, JSON.stringify(r.d)); inv = r.d;
  assert.match(inv.number, /^FA-\d{4}-0001$/); assert.equal(inv.subtotal, '199.99'); assert.equal(inv.tax_total, '30.00'); assert.equal(inv.total, '229.99'); assert.match(inv.entry_no, /^VEN\//);
  assert.equal((await call('POST', `/invoices?companyId=${C}`, { partyId: four, kind: 'VENTE', date: today, lines: [{ description: 'x', quantity: '1', unitPrice: '1', taxRate: '20' }] })).s, 400, 'vente à un fournisseur refusée');
});
test('règlements : sens, plafond, écriture + trésorerie', async () => {
  assert.equal((await call('POST', `/payments?companyId=${C}`, { invoiceId: inv.id, date: today, direction: 'DECAISSEMENT', method: 'VIREMENT', amount: '10' })).s, 400);
  assert.equal((await call('POST', `/payments?companyId=${C}`, { invoiceId: inv.id, date: today, direction: 'ENCAISSEMENT', method: 'VIREMENT', amount: '999' })).s, 400);
  assert.equal((await call('POST', `/payments?companyId=${C}`, { invoiceId: inv.id, date: today, direction: 'ENCAISSEMENT', method: 'VIREMENT', amount: '100' })).s, 201);
  const i = (await call('GET', `/invoices/${inv.id}?companyId=${C}`)).d; assert.equal(i.status, 'PARTIELLEMENT_PAYEE'); assert.equal(i.remaining, '129.99');
  assert.equal((await call('POST', `/invoices/${inv.id}/cancel?companyId=${C}`)).s, 400, 'annulation interdite si réglée');
  const d = (await call('GET', `/dashboard?companyId=${C}`)).d; assert.equal(d.invoices.receivables, '129.99'); assert.equal(d.cashTotal, '100.00');
});
test('virement interne (bug corrigé)', async () => {
  const ca = (await call('GET', `/cash-accounts?companyId=${C}`)).d;
  assert.equal((await call('POST', `/transfers?companyId=${C}`, { date: today, sourceId: ca[0].id, destinationId: ca[1].id, amount: '40' })).s, 201);
});
test('contre-passation, balance et bilan équilibrés', async () => {
  const j = (await call('GET', `/journals?companyId=${C}`)).d.find(x => x.code === 'OD'), a = (await call('GET', `/accounts?companyId=${C}`)).d;
  const e = await call('POST', `/entries?companyId=${C}`, { journalId: j.id, date: today, description: 'Test OD', lines: [{ accountId: a[0].id, debit: '50' }, { accountId: a[1].id, credit: '50' }] }); assert.equal(e.s, 201);
  assert.equal((await call('POST', `/entries?companyId=${C}`, { journalId: j.id, date: today, description: 'Faux', lines: [{ accountId: a[0].id, debit: '50' }, { accountId: a[1].id, credit: '49.99' }] })).s, 400);
  assert.equal((await call('POST', `/entries/${e.d.id}/reverse?companyId=${C}`, {})).s, 201);
  assert.equal((await call('POST', `/entries/${e.d.id}/reverse?companyId=${C}`, {})).s, 400, 'double contre-passation refusée');
  const tb = (await call('GET', `/reports/trial-balance?companyId=${C}`)).d; assert.equal(tb.totals.debit, tb.totals.credit);
  const bs = (await call('GET', `/reports/balance-sheet?companyId=${C}`)).d; assert.equal(bs.balanced, true);
  const vat = (await call('GET', `/reports/vat?companyId=${C}`)).d; assert.equal(vat.totalCollected, '30.00');
});
test('clôture d\'exercice verrouille la saisie ; rôle lecteur en lecture seule', async () => {
  const y = (await call('GET', `/fiscal-years?companyId=${C}`)).d[0];
  assert.equal((await call('POST', `/fiscal-years/${y.id}/close?companyId=${C}`)).s, 200);
  const r = await call('POST', `/invoices?companyId=${C}`, { partyId: cli, kind: 'VENTE', date: today, lines: [{ description: 'x', quantity: '1', unitPrice: '1', taxRate: '20' }] });
  assert.equal(r.s, 400); assert.match(r.d.error, /clôturé/);
  await call('POST', `/fiscal-years/${y.id}/reopen?companyId=${C}`);
  const u = (await call('POST', '/users', { name: 'Lecteur', email: 'l@x.ma', password: 'lecteur-mot-passe-1' })).d.id;
  await call('POST', `/users/${u}/access`, { companyId: C, role: 'LECTEUR' });
  const lt = (await call('POST', '/auth/login', { email: 'l@x.ma', password: 'lecteur-mot-passe-1' }, '')).d.token;
  assert.equal((await call('GET', `/invoices?companyId=${C}`, null, lt)).s, 200);
  assert.equal((await call('POST', `/third-parties?companyId=${C}`, { kind: 'CLIENT', name: 'Zed' }, lt)).s, 403);
  assert.equal((await call('GET', '/users', null, lt)).s, 403);
  assert.equal((await call('POST', '/backup', null, lt)).s, 403);
});
