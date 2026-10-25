// API do CRM de leads da Conexión América, rodando em Cloudflare Workers + D1.
// Cada rota indica a história do story map que ela atende (US-00 a US-05).

const STAGES = ['lead', 'oportunidade', 'aluno', 'base_fria'];
const TEMPERATURES = ['quente', 'medio', 'frio'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      // A Meta chama o webhook sem senha; ele se protege pela assinatura (WHATSAPP_APP_SECRET)
      if (url.pathname === '/webhook/whatsapp') return await whatsappWebhook(request, env, url);
      if (!authorized(request, env)) {
        return new Response('Acesso restrito à equipe da Conexión América', {
          status: 401,
          headers: { 'www-authenticate': 'Basic realm="CRM Conexion America", charset="UTF-8"' },
        });
      }
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ erro: err.message }, err.status);
      console.error(err);
      return json({ erro: 'Erro interno' }, 500);
    }
  },

  // Cron Trigger: marca falta nas aulas que passaram sem presença e cria a tarefa de 12h (US-02)
  async scheduled(_event, env) {
    await markNoShows(env, new Date());
  },
};

// Login simples por senha (HTTP Basic), alternativa sem custo ao Cloudflare Access.
// Sem o segredo PAINEL_SENHA configurado, o painel fica aberto (útil em desenvolvimento).
function authorized(request, env) {
  if (!env.PAINEL_SENHA) return true;
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = atob(header.slice(6)); } catch { return false; }
  const password = decoded.slice(decoded.indexOf(':') + 1); // o usuário pode ser qualquer um
  const a = new TextEncoder().encode(password);
  const b = new TextEncoder().encode(env.PAINEL_SENHA);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function body(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'JSON inválido'); }
}

function now() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

function addHours(iso, hours) {
  return new Date(new Date(iso).getTime() + hours * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Só dígitos; números brasileiros sem DDI (10 ou 11 dígitos) ganham o 55
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.length <= 11 ? '55' + digits : digits;
}

// O link wa.me do anúncio leva a mensagem pronta com o código, ex.: "Quero saber das aulas #IG-OUT26"
export function extractCampaignCode(message) {
  const match = String(message || '').match(/#([A-Za-z0-9][A-Za-z0-9_-]{1,30})/);
  return match ? match[1].toUpperCase() : null;
}

// ---------------------------------------------------------------- roteamento

async function api(request, env, url) {
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // sem o "api"
  const [resource, id, action] = parts;

  if (resource === 'config' && method === 'GET') {
    return json({ whatsapp_numero: (env.WHATSAPP_NUMERO || '').replace(/\D/g, '') });
  }
  if (resource === 'campaigns' && !id) {
    if (method === 'GET') return listCampaigns(env);
    if (method === 'POST') return createCampaign(env, await body(request));
  }
  if (resource === 'leads') {
    if (!id && method === 'GET') return listLeads(env, url.searchParams);
    if (!id && method === 'POST') return json(await registerContact(env, { ...(await body(request)), source: 'painel' }), 201);
    if (id && !action && method === 'GET') return getLead(env, Number(id));
    if (id && !action && method === 'PATCH') return updateLead(env, Number(id), await body(request));
    if (id && action === 'trials' && method === 'POST') return scheduleTrial(env, Number(id), await body(request));
    if (id && action === 'convert' && method === 'POST') return convertToStudent(env, Number(id), await body(request));
    if (id && action === 'archive' && method === 'POST') return archiveLead(env, Number(id), await body(request).catch(() => ({})));
    if (id && action === 'replied' && method === 'POST') return markReplied(env, Number(id));
  }
  if (resource === 'trials' && id && method === 'PATCH') return updateTrial(env, Number(id), await body(request));
  if (resource === 'tasks') {
    if (!id && method === 'GET') return listTasks(env);
    if (id && action === 'attempt' && method === 'POST') return taskAttempt(env, Number(id), await body(request));
  }
  if (resource === 'report' && id === 'campaigns' && method === 'GET') return campaignReport(env);
  if (resource === 'export' && id === 'leads.csv' && method === 'GET') return exportLeads(env);
  if (resource === 'cron' && id === 'run' && method === 'POST') {
    return json({ faltas: await markNoShows(env, new Date()) });
  }
  throw new HttpError(404, 'Rota não encontrada');
}

// ---------------------------------------------------------------- US-00 campanhas

async function listCampaigns(env) {
  const { results } = await env.DB.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  return json(results);
}

async function createCampaign(env, data) {
  const code = String(data.code || '').replace(/^#/, '').toUpperCase().trim();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,30}$/.test(code)) throw new HttpError(400, 'Código inválido (use letras, números e hífen, ex.: IG-OUT26)');
  if (!data.name) throw new HttpError(400, 'Informe o nome da campanha');
  try {
    const row = await env.DB.prepare(
      'INSERT INTO campaigns (code, name, channel, meta_ad_id) VALUES (?, ?, ?, ?) RETURNING *'
    ).bind(code, data.name, data.channel || 'instagram', data.meta_ad_id || null).first();
    return json(row, 201);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, 'Já existe uma campanha com esse código ou anúncio');
    throw err;
  }
}

// ---------------------------------------------------------------- US-01 lead sem duplicar

// Usado pelo painel (atendente cola número e mensagem) e pelo webhook da Cloud API.
export async function registerContact(env, { phone, name, message, campaign_code, meta_ad_id, source }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new HttpError(400, 'Telefone inválido');

  let campaign = null;
  if (meta_ad_id) {
    campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE meta_ad_id = ?').bind(String(meta_ad_id)).first();
  }
  const code = (campaign_code && String(campaign_code).replace(/^#/, '').toUpperCase()) || extractCampaignCode(message);
  if (!campaign && code) {
    campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE code = ?').bind(code).first();
  }

  const existing = await env.DB.prepare('SELECT * FROM leads WHERE phone = ?').bind(normalized).first();
  if (existing) {
    // Retorno de quem já está na base: não duplica; lead frio volta para a fila
    const reopened = existing.stage === 'base_fria';
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE leads SET stage = CASE WHEN stage = 'base_fria' THEN 'lead' ELSE stage END,
           name = COALESCE(name, ?), updated_at = ? WHERE id = ?`
      ).bind(name || null, now(), existing.id),
      env.DB.prepare(
        "INSERT INTO contacts (lead_id, kind, source, campaign_id, message) VALUES (?, 'retorno', ?, ?, ?)"
      ).bind(existing.id, source, campaign?.id ?? null, message || null),
    ]);
    return { lead_id: existing.id, novo: false, reaberto: reopened, campanha: campaign?.code ?? null };
  }

  const lead = await env.DB.prepare(
    'INSERT INTO leads (phone, name, campaign_id, origin) VALUES (?, ?, ?, ?) RETURNING id'
  ).bind(normalized, name || null, campaign?.id ?? null, campaign ? 'campanha' : 'organico').first();
  await env.DB.prepare(
    "INSERT INTO contacts (lead_id, kind, source, campaign_id, message) VALUES (?, 'primeiro_contato', ?, ?, ?)"
  ).bind(lead.id, source, campaign?.id ?? null, message || null).run();
  return { lead_id: lead.id, novo: true, reaberto: false, campanha: campaign?.code ?? null };
}

// Fila do atendente: primeiro quem ainda não recebeu resposta (o mais antigo no topo, para não perder lead),
// depois os demais pelo movimento mais recente. A temperatura não ordena a fila: o critério ainda vai ser descoberto.
async function listLeads(env, params) {
  const where = [];
  const binds = [];
  const stage = params.get('stage');
  if (stage) {
    if (!STAGES.includes(stage)) throw new HttpError(400, 'Etapa inválida');
    where.push('l.stage = ?'); binds.push(stage);
  }
  const q = params.get('q');
  if (q) { where.push('(l.name LIKE ? OR l.phone LIKE ?)'); binds.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`); }
  const sql = `
    SELECT l.*, c.code AS campaign_code, c.name AS campaign_name,
      (SELECT scheduled_at FROM trial_classes t WHERE t.lead_id = l.id AND t.status = 'agendada' ORDER BY scheduled_at LIMIT 1) AS next_trial,
      (SELECT COUNT(*) FROM tasks k WHERE k.lead_id = l.id AND k.done_at IS NULL) AS open_tasks
    FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE WHEN l.first_reply_at IS NULL AND l.stage = 'lead' THEN 0 ELSE 1 END,
      CASE WHEN l.first_reply_at IS NULL AND l.stage = 'lead' THEN l.created_at END ASC, l.updated_at DESC
    LIMIT 200`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json(results);
}

async function getLead(env, id) {
  const lead = await env.DB.prepare(
    'SELECT l.*, c.code AS campaign_code, c.name AS campaign_name FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id WHERE l.id = ?'
  ).bind(id).first();
  if (!lead) throw new HttpError(404, 'Lead não encontrado');
  const [contacts, trials, tasks, student] = await env.DB.batch([
    env.DB.prepare('SELECT ct.*, c.code AS campaign_code FROM contacts ct LEFT JOIN campaigns c ON c.id = ct.campaign_id WHERE lead_id = ? ORDER BY ct.created_at DESC').bind(id),
    env.DB.prepare('SELECT * FROM trial_classes WHERE lead_id = ? ORDER BY scheduled_at DESC').bind(id),
    env.DB.prepare('SELECT * FROM tasks WHERE lead_id = ? ORDER BY created_at DESC').bind(id),
    env.DB.prepare('SELECT * FROM students WHERE lead_id = ?').bind(id),
  ]);
  return json({ ...lead, contacts: contacts.results, trials: trials.results, tasks: tasks.results, student: student.results[0] || null });
}

// Triagem: dados que o grupo vai analisar para descobrir o que torna um lead quente.
// A temperatura (US-03) fica como palpite opcional do atendente.
async function updateLead(env, id, data) {
  const fields = { name: null, temperature: TEMPERATURES, language: ['espanhol', 'ingles'], goal: ['profissional', 'lazer', 'outro'], notes: null, consent_marketing: null,
    urgency: ['agora', 'ate_1_mes', 'sem_pressa'], level: ['iniciante', 'intermediario', 'avancado'],
    company: null, availability: null, lost_reason: null };
  const sets = [];
  const binds = [];
  for (const [key, allowed] of Object.entries(fields)) {
    if (!(key in data)) continue;
    let value = data[key] === '' ? null : data[key];
    if (key === 'consent_marketing') value = value ? 1 : 0;
    if (allowed && value !== null && !allowed.includes(value)) throw new HttpError(400, `Valor inválido para ${key}`);
    sets.push(`${key} = ?`); binds.push(value);
  }
  if (!sets.length) throw new HttpError(400, 'Nada para atualizar');
  const row = await env.DB.prepare(`UPDATE leads SET ${sets.join(', ')}, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(...binds, now(), id).first();
  if (!row) throw new HttpError(404, 'Lead não encontrado');
  return json(row);
}

// ---------------------------------------------------------------- US-02 aula experimental

async function scheduleTrial(env, leadId, data) {
  if (!data.teacher || !data.scheduled_at) throw new HttpError(400, 'Informe professor e horário');
  const when = new Date(data.scheduled_at);
  if (Number.isNaN(when.getTime())) throw new HttpError(400, 'Horário inválido');
  const lead = await env.DB.prepare('SELECT stage FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) throw new HttpError(404, 'Lead não encontrado');
  if (lead.stage === 'aluno') throw new HttpError(409, 'Este contato já é aluno');

  // O professor não pode ter duas aulas experimentais no mesmo horário (agenda definida pelo professor)
  const clash = await env.DB.prepare(
    "SELECT id FROM trial_classes WHERE teacher = ? AND status = 'agendada' AND scheduled_at = ?"
  ).bind(data.teacher, when.toISOString().replace(/\.\d{3}Z$/, 'Z')).first();
  if (clash) throw new HttpError(409, 'O professor já tem aula experimental neste horário');

  const iso = when.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const [, trial] = await env.DB.batch([
    // Reagendar: a aula anterior ainda agendada fica como "reagendada"
    env.DB.prepare("UPDATE trial_classes SET status = 'reagendada' WHERE lead_id = ? AND status = 'agendada'").bind(leadId),
    env.DB.prepare('INSERT INTO trial_classes (lead_id, teacher, scheduled_at) VALUES (?, ?, ?) RETURNING *').bind(leadId, data.teacher, iso),
    env.DB.prepare("UPDATE leads SET stage = 'oportunidade', updated_at = ? WHERE id = ?").bind(now(), leadId),
  ]);
  return json(trial.results[0], 201);
}

async function updateTrial(env, id, data) {
  const status = data.status;
  if (!['realizada', 'faltou', 'cancelada'].includes(status)) throw new HttpError(400, 'Status deve ser realizada, faltou ou cancelada');
  const trial = await env.DB.prepare('SELECT * FROM trial_classes WHERE id = ?').bind(id).first();
  if (!trial) throw new HttpError(404, 'Aula não encontrada');
  if (trial.status !== 'agendada') throw new HttpError(409, `A aula já está como ${trial.status}`);
  const stmts = [env.DB.prepare('UPDATE trial_classes SET status = ? WHERE id = ?').bind(status, id)];
  if (status === 'faltou') stmts.push(noShowTask(env, trial));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

function noShowTask(env, trial) {
  const hours = Number(env.RETOMAR_HORAS || 12);
  return env.DB.prepare("INSERT INTO tasks (lead_id, trial_id, type, due_at) VALUES (?, ?, 'retomar_contato', ?)")
    .bind(trial.lead_id, trial.id, addHours(trial.scheduled_at, hours));
}

// Aula de 30 min + tolerância sem presença marcada = falta automática
export async function markNoShows(env, at) {
  const tolerance = Number(env.FALTA_TOLERANCIA_MIN || 60);
  const limit = new Date(at.getTime() - (30 + tolerance) * 60e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const { results } = await env.DB.prepare(
    "SELECT * FROM trial_classes WHERE status = 'agendada' AND scheduled_at <= ?"
  ).bind(limit).all();
  if (!results.length) return 0;
  const stmts = [];
  for (const trial of results) {
    stmts.push(env.DB.prepare("UPDATE trial_classes SET status = 'faltou' WHERE id = ?").bind(trial.id));
    stmts.push(noShowTask(env, trial));
  }
  await env.DB.batch(stmts);
  return results.length;
}

async function listTasks(env) {
  const { results } = await env.DB.prepare(`
    SELECT k.*, l.name, l.phone, l.temperature, t.scheduled_at AS trial_at, t.teacher,
      CASE WHEN k.due_at < ? THEN 1 ELSE 0 END AS atrasada
    FROM tasks k JOIN leads l ON l.id = k.lead_id LEFT JOIN trial_classes t ON t.id = k.trial_id
    WHERE k.done_at IS NULL ORDER BY k.due_at`).bind(now()).all();
  return json(results);
}

// Cada tentativa de contato fica registrada. Sem resposta após MAX_TENTATIVAS, o lead vai para a base fria
// (proposta para a pendência em aberto; o número é configurável em wrangler.jsonc).
async function taskAttempt(env, id, data) {
  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND done_at IS NULL').bind(id).first();
  if (!task) throw new HttpError(404, 'Tarefa não encontrada ou já concluída');
  const attempts = task.attempts + 1;
  const max = Number(env.MAX_TENTATIVAS || 3);
  if (data.answered) {
    await env.DB.prepare("UPDATE tasks SET attempts = ?, done_at = ?, outcome = 'respondeu' WHERE id = ?").bind(attempts, now(), id).run();
    return json({ ok: true, resultado: 'respondeu' });
  }
  if (attempts >= max) {
    await env.DB.batch([
      env.DB.prepare("UPDATE tasks SET attempts = ?, done_at = ?, outcome = 'base_fria' WHERE id = ?").bind(attempts, now(), id),
      env.DB.prepare("UPDATE leads SET stage = 'base_fria', lost_reason = COALESCE(lost_reason, 'sem_resposta'), updated_at = ? WHERE id = ? AND stage <> 'aluno'").bind(now(), task.lead_id),
    ]);
    return json({ ok: true, resultado: 'base_fria', tentativas: attempts });
  }
  // Próxima tentativa no próximo turno
  await env.DB.prepare('UPDATE tasks SET attempts = ?, due_at = ? WHERE id = ?')
    .bind(attempts, addHours(now(), Number(env.RETOMAR_HORAS || 12)), id).run();
  return json({ ok: true, resultado: 'sem_resposta', tentativas: attempts });
}

// ---------------------------------------------------------------- US-04 vira aluno

async function convertToStudent(env, leadId, data) {
  if (!['espanhol', 'ingles'].includes(data.language)) throw new HttpError(400, 'Informe o idioma (espanhol ou ingles)');
  if (!data.package) throw new HttpError(400, 'Informe o pacote contratado');
  const lead = await env.DB.prepare('SELECT stage FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) throw new HttpError(404, 'Lead não encontrado');
  if (lead.stage === 'aluno') throw new HttpError(409, 'Este contato já é aluno');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO students (lead_id, language, package) VALUES (?, ?, ?)').bind(leadId, data.language, data.package),
    env.DB.prepare("UPDATE leads SET stage = 'aluno', language = ?, updated_at = ? WHERE id = ?").bind(data.language, now(), leadId),
    env.DB.prepare("UPDATE tasks SET done_at = ?, outcome = 'respondeu' WHERE lead_id = ? AND done_at IS NULL").bind(now(), leadId),
  ]);
  return json({ ok: true }, 201);
}

async function archiveLead(env, leadId, data) {
  const row = await env.DB.prepare(
    "UPDATE leads SET stage = 'base_fria', lost_reason = COALESCE(?, lost_reason), updated_at = ? WHERE id = ? AND stage <> 'aluno' RETURNING id"
  ).bind(data.lost_reason || null, now(), leadId).first();
  if (!row) throw new HttpError(409, 'Lead não encontrado ou já é aluno');
  await env.DB.prepare("UPDATE tasks SET done_at = ?, outcome = 'base_fria' WHERE lead_id = ? AND done_at IS NULL").bind(now(), leadId).run();
  return json({ ok: true });
}

// Tempo até a primeira resposta é um dos dados que podem explicar quem fecha
async function markReplied(env, leadId) {
  const row = await env.DB.prepare(
    'UPDATE leads SET first_reply_at = COALESCE(first_reply_at, ?), updated_at = ? WHERE id = ? RETURNING first_reply_at'
  ).bind(now(), now(), leadId).first();
  if (!row) throw new HttpError(404, 'Lead não encontrado');
  return json(row);
}

// ---------------------------------------------------------------- US-05 relatório por campanha

async function campaignReport(env) {
  const { results } = await env.DB.prepare(`
    SELECT COALESCE(c.code, 'ORGANICO') AS code, COALESCE(c.name, 'Orgânico / indicação') AS name,
      COUNT(l.id) AS leads,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM trial_classes t WHERE t.lead_id = l.id) THEN 1 ELSE 0 END) AS oportunidades,
      SUM(CASE WHEN l.stage = 'aluno' THEN 1 ELSE 0 END) AS alunos,
      SUM(CASE WHEN l.stage = 'base_fria' THEN 1 ELSE 0 END) AS base_fria
    FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id
    GROUP BY c.id ORDER BY alunos DESC, leads DESC`).all();
  return json(results);
}

// Planilha com uma linha por lead, para o grupo analisar o que diferencia quem virou aluno
const CSV_COLUMNS = ['id', 'criado_em', 'origem', 'campanha', 'etapa', 'virou_oportunidade', 'virou_aluno',
  'idioma', 'objetivo', 'urgencia', 'nivel', 'empresa', 'disponibilidade', 'palpite_temperatura',
  'minutos_ate_primeira_resposta', 'contatos', 'aulas_agendadas', 'faltas', 'tentativas_retomada',
  'dias_ate_virar_aluno', 'motivo_perda', 'consentiu_campanhas'];

async function exportLeads(env) {
  // Telefone e nome ficam de fora: a análise não precisa deles (LGPD, minimização de dados)
  const { results } = await env.DB.prepare(`
    SELECT l.id, l.created_at AS criado_em, l.origin AS origem, c.code AS campanha, l.stage AS etapa,
      EXISTS (SELECT 1 FROM trial_classes t WHERE t.lead_id = l.id) AS virou_oportunidade,
      (l.stage = 'aluno') AS virou_aluno,
      l.language AS idioma, l.goal AS objetivo, l.urgency AS urgencia, l.level AS nivel,
      l.company AS empresa, l.availability AS disponibilidade, l.temperature AS palpite_temperatura,
      CAST(ROUND((julianday(l.first_reply_at) - julianday(l.created_at)) * 1440) AS INTEGER) AS minutos_ate_primeira_resposta,
      (SELECT COUNT(*) FROM contacts ct WHERE ct.lead_id = l.id AND ct.kind <> 'nota') AS contatos,
      (SELECT COUNT(*) FROM trial_classes t WHERE t.lead_id = l.id) AS aulas_agendadas,
      (SELECT COUNT(*) FROM trial_classes t WHERE t.lead_id = l.id AND t.status = 'faltou') AS faltas,
      (SELECT COALESCE(SUM(attempts), 0) FROM tasks k WHERE k.lead_id = l.id) AS tentativas_retomada,
      CAST(ROUND(julianday(s.started_at) - julianday(l.created_at)) AS INTEGER) AS dias_ate_virar_aluno,
      l.lost_reason AS motivo_perda, l.consent_marketing AS consentiu_campanhas
    FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id LEFT JOIN students s ON s.lead_id = l.id
    ORDER BY l.created_at`).all();
  const cell = (v) => (v === null || v === undefined ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [CSV_COLUMNS.join(','), ...results.map((r) => CSV_COLUMNS.map((k) => cell(r[k])).join(','))].join('\r\n');
  return new Response('\ufeff' + csv, { // BOM para o Excel abrir os acentos corretamente
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="leads-conexion-${now().slice(0, 10)}.csv"`,
    },
  });
}

// ---------------------------------------------------------------- passo 2: WhatsApp Cloud API

async function whatsappWebhook(request, env, url) {
  // Verificação feita pela Meta ao cadastrar o webhook
  if (request.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN &&
      url.searchParams.get('hub.verify_token') === env.WHATSAPP_VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get('hub.challenge')) : new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = await request.text();
  if (env.WHATSAPP_APP_SECRET && !(await validSignature(raw, request.headers.get('x-hub-signature-256'), env.WHATSAPP_APP_SECRET))) {
    return new Response('Invalid signature', { status: 401 });
  }
  const payload = JSON.parse(raw);
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const msg of value.messages || []) {
        await registerContact(env, {
          phone: msg.from,
          name: names[msg.from],
          message: msg.text?.body || `[${msg.type}]`,
          meta_ad_id: msg.referral?.source_id, // presente quando a conversa veio de anúncio Click-to-WhatsApp
          source: 'whatsapp_api',
        });
      }
    }
  }
  return new Response('OK'); // a Meta reenvia se não receber 200
}

async function validSignature(raw, header, secret) {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === header.slice(7);
}
