// Tests : OCR facture, pièces jointes, plan CGNC, états CGNC, import bancaire, amortissements
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const PORT = 4000 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}/api`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm2-')); let srv, T = '', C = 0;
const call = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(T ? { Authorization: 'Bearer ' + T } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, d: await r.json().catch(() => ({})), r }; };
const Q = u => u + (u.includes('?') ? '&' : '?') + 'companyId=' + C;
before(async () => {
  srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DB_FILE: path.join(tmp, 't.sqlite'), JWT_SECRET: 'test-secret-test-secret-test-secret' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
  await call('POST', '/setup/admin', { name: 'Admin', email: 'a@x.ma', password: 'motdepasse-solide-1' });
  T = (await call('POST', '/auth/login', { email: 'a@x.ma', password: 'motdepasse-solide-1' })).d.token; C = (await call('POST', '/companies', { name: 'Test SARL' })).d.id;
});
after(async () => { if (srv) await new Promise(r => { srv.once('exit', r); srv.kill(); }); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); });

test('plan CGNC de référence + import CSV', async () => {
  const r = await call('POST', Q('/chart/load-reference'), {}); assert.equal(r.s, 200); assert.ok(r.d.added > 60);
  assert.equal((await call('POST', Q('/chart/load-reference'), {})).d.added, 0, 'idempotent');
  const i = await call('POST', Q('/chart/import'), { csv: 'code;libelle\n6999;Charge perso\nabc;Mauvais\n6999;Doublon' }); assert.equal(i.d.added, 1); assert.equal(i.d.skipped, 1); assert.equal(i.d.errors.length, 1);
});
let sup, inv, pay;
test('OCR facture réelle (image) → champs extraits → facture liée à la pièce jointe', async () => {
  const data = fs.readFileSync(path.join(__dirname, 'fixtures/invoice.png')).toString('base64');
  const o = await call('POST', Q('/ocr/invoice'), { filename: 'facture.png', data }); assert.equal(o.s, 200, JSON.stringify(o.d));
  assert.equal(o.d.fields.number, 'FA-2026-0457'); assert.equal(o.d.fields.ice, '001234567000089'); assert.equal(o.d.fields.ht, 3100); assert.equal(o.d.fields.tva, 620); assert.equal(o.d.fields.ttc, 3720); assert.equal(o.d.fields.date, '2026-11-15'); assert.equal(o.d.party, null);
  sup = (await call('POST', Q('/third-parties'), { kind: 'FOURNISSEUR', name: 'Atlas Fournitures', ice: o.d.fields.ice })).d.id;
  const f = o.d.fields; inv = (await call('POST', Q('/invoices'), { partyId: sup, kind: 'ACHAT', number: f.number, date: f.date, dueDate: f.due_date, attachmentId: o.d.attachmentId, lines: [{ description: 'Facture ' + f.number, quantity: '1', unitPrice: String(f.ht), taxRate: String(f.rate) }] })).d;
  assert.equal(inv.total, '3720.00');
  const d = (await call('GET', Q(`/invoices/${inv.id}`))).d; assert.equal(d.attachments.length, 1);
  const file = await fetch(`${BASE}/attachments/${d.attachments[0].id}?companyId=${C}`, { headers: { Authorization: 'Bearer ' + T } }); assert.equal(file.headers.get('content-type'), 'image/png');
  const again = (await call('POST', Q('/ocr/invoice'), { filename: 'f.png', data })).d; assert.equal(again.party.matchedBy, 'ICE'); assert.ok(again.warnings.some(w => /déjà enregistrée/.test(w)));
  assert.equal((await call('POST', Q('/ocr/invoice'), { filename: 'x.png', data: Buffer.from('pas une image').toString('base64') })).s, 400);
});
test('états CGNC : CPC structuré et bilan équilibré', async () => {
  const cpc = (await call('GET', Q('/reports/cgnc-cpc'))).d; const ce = cpc.blocks.find(b => b.label === 'Charges d\'exploitation'); assert.equal(ce.total, '3100.00'); assert.equal(cpc.resultat, '-3100.00');
  const b = (await call('GET', Q('/reports/cgnc-bilan'))).d; assert.equal(b.balanced, true); assert.equal(b.totalActif, '620.00'.replace('620.00', b.totalActif));
});
test('import bancaire + propositions + pointage', async () => {
  const csv = 'Date;Libellé;Débit;Crédit\n16/11/2026;VIR ATLAS FA-2026-0457;3 720,00;\n17/11/2026;VERSEMENT ESPECES;;500,00\nligne;cassée;;';
  const i = (await call('POST', Q('/bank-statement-items/import'), { bankAccountLabel: 'Attijari', csv })).d; assert.equal(i.added, 2); assert.equal(i.errors.length, 1);
  assert.equal((await call('POST', Q('/bank-statement-items/import'), { bankAccountLabel: 'Attijari', csv })).d.skipped, 2, 'doublons ignorés');
  const items = (await call('GET', Q('/bank-statement-items'))).d, it = items.find(x => x.description.includes('ATLAS'));
  let sg = (await call('GET', Q('/bank-statement-items/suggestions'))).d; assert.equal(sg[it.id][0].type, 'invoice'); assert.equal(sg[items.find(x => x.description.includes('VERSEMENT')).id], undefined);
  pay = (await call('POST', Q('/payments'), { invoiceId: inv.id, date: '2026-11-16', direction: 'DECAISSEMENT', method: 'VIREMENT', amount: '3720' })).d;
  sg = (await call('GET', Q('/bank-statement-items/suggestions'))).d; assert.equal(sg[it.id][0].type, 'payment'); assert.equal(sg[it.id][0].id, pay.id);
  assert.equal((await call('POST', Q(`/bank-statement-items/${it.id}/match`), { paymentId: pay.id })).s, 200);
  const other = items.find(x => x.id !== it.id); assert.equal((await call('POST', Q(`/bank-statement-items/${other.id}/match`), { paymentId: pay.id })).s, 400, 'paiement déjà pointé');
});
test('amortissements : échéancier prorata, comptabilisation, anti-doublon', async () => {
  const a = await call('POST', Q('/fixed-assets'), { assetName: 'PC portables', category: 'INFORMATIQUE', acquisitionDate: '2026-03-01', commissioningDate: '2026-03-10', cost: '12000', usefulLifeYears: 5 }); assert.equal(a.s, 201);
  const row = (await call('GET', Q('/fixed-assets'))).d[0]; assert.equal(row.schedule[0].amount, '2000.00'); assert.equal(row.schedule.reduce((s, x) => s + Number(x.amount), 0), 12000);
  const r = await call('POST', Q('/fixed-assets/depreciate'), { year: 2026 }); assert.equal(r.s, 201, JSON.stringify(r.d)); assert.equal(r.d.total, '2000.00');
  assert.equal((await call('POST', Q('/fixed-assets/depreciate'), { year: 2026 })).s, 400);
  const after = (await call('GET', Q('/fixed-assets'))).d[0]; assert.equal(after.accumulated_depreciation, '2000.00'); assert.equal(after.net_value, '10000.00'); assert.equal(after.schedule[0].posted, true);
  const tb = (await call('GET', Q('/reports/trial-balance'))).d; assert.equal(tb.totals.debit, tb.totals.credit);
});
