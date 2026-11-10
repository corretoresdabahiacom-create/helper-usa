-- Helper Connect — initial schema (Cloudflare D1 / SQLite)
-- Conventions: TEXT uuid primary keys; money as INTEGER cents + explicit currency;
-- dates as 'YYYY-MM-DD' (contractor-local), timestamps as ISO-8601 UTC strings.
-- Tenant isolation: every private table carries owner_id and uses composite
-- FOREIGN KEYs (id, owner_id) so a row can never reference another tenant's row.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','deleted')),
  email_verified_at TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  mfa_secret TEXT,                       -- reserved for optional TOTP MFA (architecture only)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE administrator_roles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin','support')),
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify_email','reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE contractor_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  business_name TEXT,
  phone TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  state TEXT,
  city TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','pt','es')),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  currency TEXT NOT NULL DEFAULT 'USD',
  accounting_basis TEXT NOT NULL DEFAULT 'accrual' CHECK (accounting_basis IN ('accrual','cash')),
  opening_cash_cents INTEGER NOT NULL DEFAULT 0,
  opening_cash_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  message_alerts INTEGER NOT NULL DEFAULT 1,
  payment_reminders INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('security','financial','admin','data')),
  owner_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,                          -- JSON, never contains secrets or message bodies
  created_at TEXT NOT NULL
);
CREATE INDEX ix_audit_owner ON audit_logs(owner_id, created_at);
CREATE INDEX ix_audit_scope ON audit_logs(scope, created_at);

-- ───────────── Service categories (global, admin-editable, translated) ─────────────
CREATE TABLE service_categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_pt TEXT NOT NULL,
  name_es TEXT NOT NULL,
  licensed_trade INTEGER NOT NULL DEFAULT 0,   -- 1 = work commonly requires a license; helper role is NOT licensed work
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE service_subcategories (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_pt TEXT NOT NULL,
  name_es TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_subcat_cat ON service_subcategories(category_id);

-- ───────────── Private helper directory ─────────────
CREATE TABLE helpers (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  state TEXT NOT NULL,
  city TEXT NOT NULL,
  main_category_id TEXT NOT NULL REFERENCES service_categories(id),
  function_title TEXT NOT NULL,
  whatsapp_e164 TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','pt','es')),
  description TEXT NOT NULL,
  experience TEXT,
  skills TEXT,
  certifications TEXT,
  licenses TEXT,
  availability TEXT,
  work_preferences TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  messaging_consent TEXT NOT NULL DEFAULT 'unknown' CHECK (messaging_consent IN ('unknown','granted','revoked')),
  opted_out INTEGER NOT NULL DEFAULT 0,
  last_contacted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, owner_id)
);
CREATE INDEX ix_helpers_owner ON helpers(owner_id, archived_at, state, city);
CREATE INDEX ix_helpers_owner_fav ON helpers(owner_id, favorite);

CREATE TABLE helper_categories (
  helper_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES service_categories(id),
  PRIMARY KEY (helper_id, category_id),
  FOREIGN KEY (helper_id, owner_id) REFERENCES helpers(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX ix_hc_cat ON helper_categories(owner_id, category_id);

CREATE TABLE helper_private (
  helper_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  agreed_amount_cents INTEGER CHECK (agreed_amount_cents IS NULL OR agreed_amount_cents >= 0),
  payment_unit TEXT CHECK (payment_unit IN ('hour','day','job','other')),
  last_job TEXT,
  last_job_location TEXT,
  last_job_date TEXT,
  notes TEXT,
  eval_quality INTEGER CHECK (eval_quality BETWEEN 1 AND 5),
  eval_punctuality INTEGER CHECK (eval_punctuality BETWEEN 1 AND 5),
  eval_reliability INTEGER CHECK (eval_reliability BETWEEN 1 AND 5),
  eval_communication INTEGER CHECK (eval_communication BETWEEN 1 AND 5),
  eval_overall INTEGER CHECK (eval_overall BETWEEN 1 AND 5),
  would_hire_again INTEGER CHECK (would_hire_again IN (0,1)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (helper_id, owner_id) REFERENCES helpers(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE helper_job_history (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,
  job_name TEXT NOT NULL,
  location TEXT,
  job_date TEXT,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (helper_id, owner_id) REFERENCES helpers(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX ix_hjh ON helper_job_history(owner_id, helper_id);

CREATE TABLE consent_records (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  helper_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('terms','privacy','messaging')),
  status TEXT NOT NULL CHECK (status IN ('granted','revoked')),
  source TEXT NOT NULL,                  -- e.g. registration, contractor_attested, helper_portal
  created_at TEXT NOT NULL
);
CREATE INDEX ix_consent_owner ON consent_records(owner_id, helper_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (helper_id, owner_id) REFERENCES helpers(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX ix_inv_helper ON invitations(helper_id);

-- ───────────── Projects, assignments, workdays ─────────────
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  customer TEXT,
  location TEXT,
  city TEXT,
  state TEXT,
  start_date TEXT,
  expected_end_date TEXT,
  actual_end_date TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','completed','canceled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, owner_id)
);
CREATE INDEX ix_projects_owner ON projects(owner_id, status);

CREATE TABLE work_assignments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,
  project_id TEXT,
  category_id TEXT REFERENCES service_categories(id),
  job_name TEXT NOT NULL,
  location TEXT,
  street TEXT,
  city TEXT,
  state TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  default_daily_rate_cents INTEGER NOT NULL CHECK (default_daily_rate_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  details TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','canceled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (helper_id, owner_id) REFERENCES helpers(id, owner_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, owner_id) REFERENCES projects(id, owner_id) ON DELETE RESTRICT
);
CREATE INDEX ix_wa_owner ON work_assignments(owner_id, helper_id);
CREATE INDEX ix_wa_project ON work_assignments(owner_id, project_id);

CREATE TABLE workdays (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,
  project_id TEXT,
  work_date TEXT NOT NULL,
  daily_rate_cents INTEGER NOT NULL CHECK (daily_rate_cents >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','absent','canceled')),
  amount_override_cents INTEGER CHECK (amount_override_cents IS NULL OR amount_override_cents >= 0),
  adjustment_reason TEXT,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (assignment_id, owner_id) REFERENCES work_assignments(id, owner_id) ON DELETE RESTRICT,
  FOREIGN KEY (helper_id, owner_id) REFERENCES helpers(id, owner_id) ON DELETE RESTRICT
);
-- No duplicate workday per assignment+date and no double-booking of a helper on one date (canceled rows are exempt).
CREATE UNIQUE INDEX ux_workday_assignment_date ON workdays(assignment_id, work_date) WHERE status <> 'canceled';
CREATE UNIQUE INDEX ux_workday_helper_date ON workdays(helper_id, work_date) WHERE status <> 'canceled';
CREATE INDEX ix_workdays_owner_date ON workdays(owner_id, work_date, status);
CREATE INDEX ix_workdays_helper ON workdays(owner_id, helper_id, work_date);

-- DB-level guard: a workday can never be over-paid, even under concurrent requests.
CREATE TRIGGER trg_workdays_guard BEFORE UPDATE ON workdays
WHEN NEW.paid_cents < 0
  OR NEW.paid_cents > COALESCE(NEW.amount_override_cents, NEW.daily_rate_cents)
  OR (NEW.status <> 'completed' AND NEW.paid_cents > 0)
BEGIN SELECT RAISE(ABORT, 'workday_overpaid'); END;

-- ───────────── Finance ─────────────
CREATE TABLE financial_categories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('revenue','expense')),
  name TEXT NOT NULL,
  -- DRE classification (configurable per category):
  dre_class TEXT NOT NULL CHECK (dre_class IN
    ('revenue_services','revenue_other','financial_income','deduction','direct_cost','operating','financial_expense','other_expense')),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (owner_id, kind, name),
  UNIQUE (id, owner_id)
);

CREATE TABLE receivables (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  customer TEXT NOT NULL,
  description TEXT NOT NULL,
  project_id TEXT,
  category_id TEXT NOT NULL,
  original_cents INTEGER NOT NULL CHECK (original_cents > 0),
  received_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  issue_date TEXT NOT NULL,
  recognition_date TEXT NOT NULL,        -- accrual recognition date (defaults to issue_date)
  due_date TEXT,
  expected_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','canceled','written_off')),
  installment_group TEXT,
  installment_no INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (category_id, owner_id) REFERENCES financial_categories(id, owner_id),
  FOREIGN KEY (project_id, owner_id) REFERENCES projects(id, owner_id) ON DELETE RESTRICT
);
CREATE INDEX ix_recv_owner_rec ON receivables(owner_id, recognition_date);
CREATE INDEX ix_recv_owner_due ON receivables(owner_id, due_date);
CREATE TRIGGER trg_recv_guard BEFORE UPDATE ON receivables
WHEN NEW.received_cents < 0 OR NEW.received_cents > NEW.original_cents
BEGIN SELECT RAISE(ABORT, 'receivable_overpaid'); END;

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  receivable_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL,
  received_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','check','zelle','card','other')),
  notes TEXT,
  idempotency_key TEXT,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (receivable_id, owner_id) REFERENCES receivables(id, owner_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_receipts_idem ON receipts(owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_receipts_date ON receipts(owner_id, received_date);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  description TEXT NOT NULL,
  payee TEXT,
  category_id TEXT NOT NULL,
  project_id TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  expense_date TEXT NOT NULL,            -- accrual recognition date
  due_date TEXT,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','weekly','monthly','yearly')),
  recurrence_group TEXT,
  installment_group TEXT,
  installment_no INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','canceled','written_off')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (category_id, owner_id) REFERENCES financial_categories(id, owner_id),
  FOREIGN KEY (project_id, owner_id) REFERENCES projects(id, owner_id) ON DELETE RESTRICT
);
CREATE INDEX ix_exp_owner_date ON expenses(owner_id, expense_date);
CREATE INDEX ix_exp_owner_due ON expenses(owner_id, due_date);
CREATE TRIGGER trg_exp_guard BEFORE UPDATE ON expenses
WHEN NEW.paid_cents < 0 OR NEW.paid_cents > NEW.amount_cents
BEGIN SELECT RAISE(ABORT, 'expense_overpaid'); END;

CREATE TABLE expense_payments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL,
  paid_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','check','zelle','card','other')),
  notes TEXT,
  idempotency_key TEXT,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (expense_id, owner_id) REFERENCES expenses(id, owner_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_exppay_idem ON expense_payments(owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_exppay_date ON expense_payments(owner_id, paid_date);

CREATE TABLE helper_payments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL,
  paid_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','check','zelle','card','other')),
  notes TEXT,
  idempotency_key TEXT,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (id, owner_id),
  FOREIGN KEY (helper_id, owner_id) REFERENCES helpers(id, owner_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_hpay_idem ON helper_payments(owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_hpay_date ON helper_payments(owner_id, paid_date);

-- Traceable link: which payment settled which workday (and how much).
CREATE TABLE payment_allocations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  workday_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  FOREIGN KEY (payment_id, owner_id) REFERENCES helper_payments(id, owner_id) ON DELETE RESTRICT,
  FOREIGN KEY (workday_id, owner_id) REFERENCES workdays(id, owner_id) ON DELETE RESTRICT
);
CREATE INDEX ix_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX ix_alloc_workday ON payment_allocations(workday_id);

CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('investing','financing')),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL,
  move_date TEXT NOT NULL,
  description TEXT NOT NULL,
  voided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_cashmov ON cash_movements(owner_id, move_date);

CREATE TABLE accounting_adjustments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('receivable_writeoff','workday_amount','workday_rate')),
  ref_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  adjust_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_adj ON accounting_adjustments(owner_id, kind, adjust_date);

-- ───────────── Messaging (24h expiry) ─────────────
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (id, owner_id),
  UNIQUE (owner_id, helper_id),            -- exactly one private contractor<->helper thread; never shared
  FOREIGN KEY (helper_id, owner_id) REFERENCES helpers(id, owner_id) ON DELETE CASCADE
);
CREATE TABLE conversation_participants (
  conversation_id TEXT NOT NULL,
  participant_type TEXT NOT NULL CHECK (participant_type IN ('contractor','helper')),
  participant_id TEXT NOT NULL,
  PRIMARY KEY (conversation_id, participant_type),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('contractor','helper')),
  body TEXT,                               -- NULL after expiry cleanup (tombstone keeps minimal metadata)
  original_language TEXT NOT NULL DEFAULT 'en',
  delivery_status TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent','delivered','read')),
  bulk_batch_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT,
  expiration_status TEXT NOT NULL DEFAULT 'active' CHECK (expiration_status IN ('active','deleted','failed')),
  FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX ix_msg_conv ON messages(conversation_id, created_at);
CREATE INDEX ix_msg_expiry ON messages(expiration_status, expires_at);
CREATE TABLE message_translations (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  lang TEXT NOT NULL CHECK (lang IN ('en','pt','es')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, lang)
);
CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX ix_att_expiry ON message_attachments(deleted_at, expires_at);
CREATE TABLE message_exports (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('pdf','txt')),
  requested_by TEXT NOT NULL CHECK (requested_by IN ('contractor','helper')),
  message_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- ───────────── Administration ─────────────
CREATE TABLE abuse_reports (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  helper_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','closed')),
  created_at TEXT NOT NULL
);
CREATE TABLE support_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  created_at TEXT NOT NULL
);
CREATE TABLE admin_access_grants (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  details TEXT
);
