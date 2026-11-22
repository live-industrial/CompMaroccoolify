PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'ADMIN',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,ice TEXT DEFAULT '',if_number TEXT DEFAULT '',rc TEXT DEFAULT '',patente TEXT DEFAULT '',address TEXT DEFAULT '',phone TEXT DEFAULT '',email TEXT DEFAULT '',currency TEXT NOT NULL DEFAULT 'MAD',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(user_id INTEGER NOT NULL REFERENCES users(id),company_id INTEGER NOT NULL REFERENCES companies(id),role TEXT NOT NULL DEFAULT 'COMPTABLE',PRIMARY KEY(user_id,company_id));
CREATE TABLE IF NOT EXISTS fiscal_years(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),label TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN',UNIQUE(company_id,label));
CREATE TABLE IF NOT EXISTS periods(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),label TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN');
CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),code TEXT NOT NULL,label TEXT NOT NULL,type TEXT NOT NULL,auxiliary INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,UNIQUE(company_id,code));
CREATE TABLE IF NOT EXISTS journals(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),code TEXT NOT NULL,label TEXT NOT NULL,type TEXT NOT NULL,UNIQUE(company_id,code));
CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),journal_id INTEGER NOT NULL REFERENCES journals(id),entry_date TEXT NOT NULL,reference TEXT DEFAULT '',description TEXT NOT NULL,status TEXT NOT NULL,total_debit TEXT NOT NULL,total_credit TEXT NOT NULL,created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL,validated_at TEXT);
CREATE TABLE IF NOT EXISTS entry_lines(id INTEGER PRIMARY KEY AUTOINCREMENT,entry_id INTEGER NOT NULL REFERENCES entries(id),account_id INTEGER NOT NULL REFERENCES accounts(id),label TEXT DEFAULT '',debit TEXT NOT NULL,credit TEXT NOT NULL,third_party TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS third_parties(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),kind TEXT NOT NULL,name TEXT NOT NULL,ice TEXT DEFAULT '',if_number TEXT DEFAULT '',email TEXT DEFAULT '',phone TEXT DEFAULT '',address TEXT DEFAULT '',payment_terms INTEGER NOT NULL DEFAULT 30,UNIQUE(company_id,kind,name));
CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),party_id INTEGER NOT NULL REFERENCES third_parties(id),kind TEXT NOT NULL,number TEXT NOT NULL,invoice_date TEXT NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'BROUILLON',subtotal TEXT NOT NULL,tax_total TEXT NOT NULL,total TEXT NOT NULL,paid_total TEXT NOT NULL DEFAULT '0.00',notes TEXT DEFAULT '',created_at TEXT NOT NULL,UNIQUE(company_id,kind,number));
CREATE TABLE IF NOT EXISTS invoice_lines(id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_id INTEGER NOT NULL REFERENCES invoices(id),description TEXT NOT NULL,quantity TEXT NOT NULL,unit_price TEXT NOT NULL,tax_rate TEXT NOT NULL,tax_amount TEXT NOT NULL,line_total TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),invoice_id INTEGER REFERENCES invoices(id),party_id INTEGER REFERENCES third_parties(id),payment_date TEXT NOT NULL,direction TEXT NOT NULL,method TEXT NOT NULL,reference TEXT DEFAULT '',amount TEXT NOT NULL,account_label TEXT DEFAULT '',notes TEXT DEFAULT '',created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cash_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'BANQUE',opening_balance TEXT NOT NULL DEFAULT '0.00',active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS cash_movements(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id),movement_date TEXT NOT NULL,direction TEXT NOT NULL,category TEXT NOT NULL,label TEXT NOT NULL,reference TEXT DEFAULT '',amount TEXT NOT NULL,created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tax_rates(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id),label TEXT NOT NULL,rate TEXT NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT,legal_reference TEXT DEFAULT '',validation_status TEXT NOT NULL DEFAULT 'A_VALIDER');
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,company_id INTEGER,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT,detail TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_entries_company_date ON entries(company_id,entry_date);
CREATE INDEX IF NOT EXISTS idx_invoice_due ON invoices(company_id,due_date,status);
CREATE INDEX IF NOT EXISTS idx_payment_invoice ON payments(invoice_id);

-- Modules professionnels complémentaires
CREATE TABLE IF NOT EXISTS cheque_remittances(
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id),
 remittance_date TEXT NOT NULL, bank_account_label TEXT NOT NULL, reference TEXT DEFAULT '', cheque_count INTEGER NOT NULL,
 total_amount TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'A_DEPOSER', notes TEXT DEFAULT '', created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_statement_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id),
 bank_account_label TEXT NOT NULL, statement_date TEXT NOT NULL, reference TEXT DEFAULT '', description TEXT NOT NULL,
 amount TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), reconciled INTEGER NOT NULL DEFAULT 0,
 matched_note TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fixed_assets(
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id),
 asset_name TEXT NOT NULL, asset_code TEXT DEFAULT '', acquisition_date TEXT NOT NULL, commissioning_date TEXT NOT NULL,
 acquisition_cost TEXT NOT NULL, useful_life_years INTEGER NOT NULL, residual_value TEXT NOT NULL DEFAULT '0',
 depreciation_method TEXT NOT NULL DEFAULT 'LINEAIRE', status TEXT NOT NULL DEFAULT 'ACTIF', notes TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entry_templates(
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id),
 template_name TEXT NOT NULL, journal_id INTEGER NOT NULL REFERENCES journals(id), description TEXT NOT NULL,
 debit_account_id INTEGER NOT NULL REFERENCES accounts(id), credit_account_id INTEGER NOT NULL REFERENCES accounts(id),
 amount_hint TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounting_transfers(
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id),
 transfer_date TEXT NOT NULL, source_cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id),
 destination_cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id), amount TEXT NOT NULL, reference TEXT DEFAULT '', notes TEXT DEFAULT '', created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS year_closings(
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id),
 fiscal_year_label TEXT NOT NULL, closing_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PREPARATION', checklist_json TEXT NOT NULL DEFAULT '{}',
 notes TEXT DEFAULT '', created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(company_id,fiscal_year_label)
);
