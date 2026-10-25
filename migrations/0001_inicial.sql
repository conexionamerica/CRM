-- Esquema inicial do CRM de leads da Conexión América (faixa MVP do story map).
-- Ciclo de vida do lead (coluna leads.stage):
--   lead -> oportunidade (agendou aula experimental) -> aluno (contratou)
--   ou base_fria (não contratou; fica na base para campanhas futuras)

-- US-00: campanhas do Instagram (criadas no gerenciador da Meta; aqui só registramos a origem)
CREATE TABLE campaigns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,          -- código que vai na mensagem do link wa.me, ex.: IG-OUT26
  name        TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'instagram',
  meta_ad_id  TEXT UNIQUE,                   -- id do anúncio (chega no webhook da Cloud API em referral.source_id)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- US-01: o telefone é a chave que impede duplicar o lead
CREATE TABLE leads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  phone        TEXT NOT NULL UNIQUE,         -- só dígitos, com DDI (ex.: 5511999998888)
  name         TEXT,
  campaign_id  INTEGER REFERENCES campaigns(id), -- primeira campanha que trouxe o lead (crédito da campanha)
  origin       TEXT NOT NULL DEFAULT 'organico' CHECK (origin IN ('campanha','organico')),
  stage        TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','oportunidade','aluno','base_fria')),
  temperature  TEXT CHECK (temperature IN ('quente','medio','frio')), -- US-03, marcado pelo atendente
  language     TEXT CHECK (language IN ('espanhol','ingles')),
  goal         TEXT CHECK (goal IN ('profissional','lazer','outro')),
  notes        TEXT,
  consent_marketing INTEGER NOT NULL DEFAULT 0, -- LGPD: só entra em campanha de lead frio quem autorizou
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_leads_stage ON leads(stage, temperature);

-- Cada vez que a pessoa escreve (primeiro contato ou retorno) fica registrado aqui
CREATE TABLE contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      INTEGER NOT NULL REFERENCES leads(id),
  kind         TEXT NOT NULL CHECK (kind IN ('primeiro_contato','retorno','nota')),
  source       TEXT NOT NULL DEFAULT 'painel' CHECK (source IN ('painel','whatsapp_api')),
  campaign_id  INTEGER REFERENCES campaigns(id),
  message      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_contacts_lead ON contacts(lead_id);

-- US-02: aula experimental de 30 min
CREATE TABLE trial_classes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER NOT NULL REFERENCES leads(id),
  teacher       TEXT NOT NULL,
  scheduled_at  TEXT NOT NULL,               -- ISO 8601 em UTC
  status        TEXT NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada','realizada','faltou','reagendada','cancelada')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_trials_status ON trial_classes(status, scheduled_at);

-- US-02: tarefa de retomar contato em até 12h após a falta
CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL REFERENCES leads(id),
  trial_id    INTEGER REFERENCES trial_classes(id),
  type        TEXT NOT NULL DEFAULT 'retomar_contato',
  due_at      TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  outcome     TEXT,                          -- respondeu | sem_resposta | base_fria
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_tasks_open ON tasks(done_at, due_at);

-- US-04: a oportunidade que contrata vira conta de aluno
CREATE TABLE students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL UNIQUE REFERENCES leads(id),
  language    TEXT NOT NULL CHECK (language IN ('espanhol','ingles')),
  package     TEXT NOT NULL,                 -- ex.: "8 aulas/mês"
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
