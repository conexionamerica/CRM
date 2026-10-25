// Painel do atendente: fila de leads, tarefas de retomada e resultado por campanha.

const $ = (sel) => document.querySelector(sel);
const ETAPAS = { lead: 'Lead', oportunidade: 'Oportunidade', aluno: 'Aluno', base_fria: 'Lead frio (base)' };
const TEMPS = { quente: 'Quente', medio: 'Médio', frio: 'Frio' };
const IDIOMAS = { espanhol: 'Espanhol', ingles: 'Inglês' };
const OBJETIVOS = { profissional: 'Profissional', lazer: 'Lazer / viagem', outro: 'Outro' };
const URGENCIAS = { agora: 'Quer começar já', ate_1_mes: 'Em até 1 mês', sem_pressa: 'Sem pressa' };
const NIVEIS = { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' };
const MOTIVOS = { preco: 'Preço', horario: 'Horário', sem_resposta: 'Sem resposta', so_pesquisando: 'Só pesquisando', outro: 'Outro' };
const STATUS_AULA = { agendada: 'Agendada', realizada: 'Realizada', faltou: 'Faltou', reagendada: 'Reagendada', cancelada: 'Cancelada' };
let config = { whatsapp_numero: '' };

// Nomes e mensagens chegam do WhatsApp: tudo que vai para o HTML passa por aqui
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const data = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const fone = (p) => (p?.startsWith('55') && p.length >= 12 ? `+55 (${p.slice(2, 4)}) ${p.slice(4, -4)}-${p.slice(-4)}` : '+' + p);

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: { 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.erro || `Erro ${res.status}`);
  return json;
}

function avisar(el, texto, erro = false) {
  el.textContent = texto;
  el.className = 'aviso' + (erro ? ' erro' : '');
}

// ------------------------------------------------------------ abas

document.querySelectorAll('nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('ativo', b === btn));
    document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== btn.dataset.tab));
    carregar(btn.dataset.tab);
  });
});

function carregar(tab) {
  if (tab === 'fila') return carregarLeads();
  if (tab === 'tarefas') return carregarTarefas();
  if (tab === 'campanhas') return carregarRelatorio();
}

// ------------------------------------------------------------ fila

$('#form-lead').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const aviso = $('#aviso-lead');
  try {
    const r = await api('/leads', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    const origem = r.campanha ? `campanha ${r.campanha}` : 'orgânico / indicação';
    avisar(aviso, r.novo ? `Lead criado (${origem}).` : r.reaberto ? 'Esse número estava na base fria e voltou para a fila.' : 'Esse número já existia: o novo contato foi registrado no mesmo lead.');
    form.reset();
    carregarLeads();
  } catch (err) { avisar(aviso, err.message, true); }
});

let buscaTimer;
$('#busca').addEventListener('input', () => { clearTimeout(buscaTimer); buscaTimer = setTimeout(carregarLeads, 250); });
$('#filtro-etapa').addEventListener('change', carregarLeads);

async function carregarLeads() {
  const params = new URLSearchParams();
  if ($('#busca').value) params.set('q', $('#busca').value);
  if ($('#filtro-etapa').value) params.set('stage', $('#filtro-etapa').value);
  const leads = await api('/leads?' + params);
  $('#lista-leads').innerHTML = leads.length ? leads.map((l) => `
    <tr data-id="${l.id}">
      <td>${esc(l.name || 'Sem nome')}<small>${esc(fone(l.phone))}</small></td>
      <td><span class="etapa ${l.stage}">${ETAPAS[l.stage]}</span>${l.open_tasks ? '<small>tarefa aberta</small>' : ''}</td>
      <td>${l.first_reply_at ? esc(data(l.first_reply_at)) : l.stage === 'lead' ? '<span class="atraso">Aguardando</span>' : ''}</td>
      <td>${esc([IDIOMAS[l.language], OBJETIVOS[l.goal], URGENCIAS[l.urgency]].filter(Boolean).join(' · ')) || '<small>a completar</small>'}</td>
      <td>${esc(l.campaign_code || 'Orgânico')}</td>
      <td>${l.next_trial ? esc(data(l.next_trial)) : ''}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="vazio">Nenhum lead ainda.</td></tr>';
}

$('#lista-leads').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (tr) abrirFicha(Number(tr.dataset.id));
});

// ------------------------------------------------------------ ficha do lead

async function abrirFicha(id) {
  const l = await api('/leads/' + id);
  const aulaAberta = l.trials.find((t) => t.status === 'agendada');
  const sel = (name, opts, atual) => `<select name="${name}"><option value="">—</option>${Object.entries(opts).map(([v, t]) => `<option value="${v}" ${v === atual ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  $('#ficha-conteudo').innerHTML = `
    <div class="ficha-topo">
      <div><h2>${esc(l.name || 'Sem nome')}</h2>${esc(fone(l.phone))} · <span class="etapa ${l.stage}">${ETAPAS[l.stage]}</span><br>
        <small>Origem: ${esc(l.campaign_name ? `${l.campaign_code} · ${l.campaign_name}` : 'orgânico / indicação')} · desde ${esc(data(l.created_at))}</small><br>
        ${l.first_reply_at ? `<small>Primeira resposta em ${esc(data(l.first_reply_at))}</small>` : '<button type="button" class="sec" data-acao="respondi">Respondi no WhatsApp agora</button>'}</div>
      <button class="sec" data-acao="fechar">Fechar</button>
    </div>

    <form class="bloco" data-form="triagem">
      <div class="grid">
        <label>Nome <input name="name" value="${esc(l.name)}"></label>
        <label>Idioma ${sel('language', IDIOMAS, l.language)}</label>
        <label>Objetivo ${sel('goal', OBJETIVOS, l.goal)}</label>
        <label>Urgência ${sel('urgency', URGENCIAS, l.urgency)}</label>
        <label>Nível ${sel('level', NIVEIS, l.level)}</label>
        <label>Empresa <input name="company" value="${esc(l.company)}" placeholder="Se for profissional"></label>
        <label>Disponibilidade <input name="availability" value="${esc(l.availability)}" placeholder="Ex.: seg e qua à noite"></label>
        <label>Seu palpite (opcional) ${sel('temperature', TEMPS, l.temperature)}</label>
        <label class="largo">Observações <textarea name="notes" rows="2">${esc(l.notes)}</textarea></label>
        <label class="largo" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="consent_marketing" ${l.consent_marketing ? 'checked' : ''}> Autorizou receber campanhas (LGPD)</label>
      </div>
      <button>Salvar triagem</button>
    </form>

    ${l.stage !== 'aluno' ? `
    <form class="bloco" data-form="aula">
      <h2>${aulaAberta ? 'Reagendar' : 'Agendar'} aula experimental</h2>
      ${aulaAberta ? `<p>Agendada para <b>${esc(data(aulaAberta.scheduled_at))}</b> com ${esc(aulaAberta.teacher)}.
        <button type="button" class="sec" data-acao="realizada" data-trial="${aulaAberta.id}">Compareceu</button>
        <button type="button" class="perigo" data-acao="faltou" data-trial="${aulaAberta.id}">Faltou</button></p>` : ''}
      <div class="linha">
        <label>Professor <input name="teacher" required></label>
        <label>Data e hora <input name="scheduled_at" type="datetime-local" required></label>
        <button>${aulaAberta ? 'Reagendar' : 'Agendar'}</button>
      </div>
    </form>

    <form class="bloco" data-form="aluno">
      <h2>Contratou? Criar conta de aluno</h2>
      <div class="linha">
        <label>Idioma ${sel('language', IDIOMAS, l.language)}</label>
        <label>Pacote <input name="package" required placeholder="8 aulas/mês"></label>
        <button>Virar aluno</button>
      </div>
      ${l.stage !== 'base_fria' ? `<div class="linha" style="margin-top:10px">
        <label>Motivo de não fechar ${sel('lost_reason', MOTIVOS, l.lost_reason)}</label>
        <button type="button" class="perigo" data-acao="arquivar">Não fechou: mover para base fria</button>` : `<p><small>Na base fria${l.lost_reason ? ' · motivo: ' + esc(MOTIVOS[l.lost_reason] || l.lost_reason) : ''}</small></p><div>`}
      </div>
    </form>` : `<p class="bloco">Aluno desde ${esc(data(l.student?.started_at))} · ${esc(l.student?.language)} · ${esc(l.student?.package)}</p>`}

    <div class="bloco"><h2>Histórico</h2><ul class="hist">
      ${[...l.contacts.map((c) => ({ at: c.created_at, t: `${c.kind === 'primeiro_contato' ? 'Primeiro contato' : 'Voltou a escrever'}${c.campaign_code ? ' (' + c.campaign_code + ')' : ''}: ${c.message || ''}` })),
         ...l.trials.map((t) => ({ at: t.scheduled_at, t: `Aula experimental com ${t.teacher}: ${STATUS_AULA[t.status]}` })),
         ...l.tasks.map((k) => ({ at: k.created_at, t: `Tarefa de retomar contato (${k.attempts} tentativa(s))${k.outcome ? ': ' + k.outcome.replace('_', ' ') : ''}` }))]
        .sort((a, b) => b.at.localeCompare(a.at)).map((h) => `<li><small>${esc(data(h.at))}</small> ${esc(h.t)}</li>`).join('')}
    </ul></div>
    <p class="aviso" id="aviso-ficha" role="status"></p>`;

  const dlg = $('#ficha');
  const aviso = () => $('#aviso-ficha');
  const depois = async () => { await abrirFicha(id); carregarLeads(); atualizarBadge(); };
  dlg.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const dados = Object.fromEntries(new FormData(f));
    try {
      if (f.dataset.form === 'triagem') await api('/leads/' + id, { method: 'PATCH', body: { ...dados, consent_marketing: f.consent_marketing.checked } });
      if (f.dataset.form === 'aula') await api(`/leads/${id}/trials`, { method: 'POST', body: { ...dados, scheduled_at: new Date(dados.scheduled_at).toISOString() } });
      if (f.dataset.form === 'aluno') await api(`/leads/${id}/convert`, { method: 'POST', body: dados });
      await depois();
    } catch (err) { avisar(aviso(), err.message, true); }
  };
  dlg.onclick = async (e) => {
    const acao = e.target.dataset?.acao;
    if (!acao) return;
    if (acao === 'fechar') return dlg.close();
    try {
      if (acao === 'realizada' || acao === 'faltou') await api('/trials/' + e.target.dataset.trial, { method: 'PATCH', body: { status: acao } });
      if (acao === 'respondi') await api(`/leads/${id}/replied`, { method: 'POST' });
      if (acao === 'arquivar') await api(`/leads/${id}/archive`, { method: 'POST', body: { lost_reason: dlg.querySelector('[name=lost_reason]').value || null } });
      await depois();
    } catch (err) { avisar(aviso(), err.message, true); }
  };
  if (!dlg.open) dlg.showModal();
}

// ------------------------------------------------------------ tarefas

async function carregarTarefas() {
  const tarefas = await api('/tasks');
  atualizarBadge(tarefas);
  $('#lista-tarefas').innerHTML = tarefas.length ? tarefas.map((k) => `
    <div class="card tarefa ${k.atrasada ? 'atrasada' : ''}">
      <div><b>${esc(k.name || 'Sem nome')}</b> · ${esc(fone(k.phone))}<br>
        <small>Faltou à aula de ${esc(data(k.trial_at))} com ${esc(k.teacher)} · ${k.attempts} tentativa(s)</small><br>
        ${k.atrasada ? '<span class="atraso">Atrasada</span> · ' : ''}<small>Retomar até ${esc(data(k.due_at))}</small></div>
      <div class="acoes">
        <a href="https://wa.me/${esc(k.phone)}" target="_blank" rel="noopener"><button class="sec" type="button">Abrir WhatsApp</button></a>
        <button data-tarefa="${k.id}" data-resp="1">Respondeu</button>
        <button class="perigo" data-tarefa="${k.id}" data-resp="0">Sem resposta</button>
        <button class="sec" data-lead="${k.lead_id}">Ficha</button>
      </div>
    </div>`).join('') : '<p class="vazio">Nenhuma tarefa aberta. Quando um lead faltar à aula experimental, a tarefa de retomar o contato aparece aqui.</p>';
}

$('#lista-tarefas').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.lead) return abrirFicha(Number(b.dataset.lead));
  if (!b.dataset.tarefa) return;
  const r = await api(`/tasks/${b.dataset.tarefa}/attempt`, { method: 'POST', body: { answered: b.dataset.resp === '1' } });
  if (r.resultado === 'base_fria') alert(`Sem resposta após ${r.tentativas} tentativas: o lead foi para a base fria.`);
  carregarTarefas();
});

async function atualizarBadge(lista) {
  const tarefas = lista || (await api('/tasks'));
  const atrasadas = tarefas.filter((t) => t.atrasada).length;
  const badge = $('#badge-tarefas');
  badge.hidden = !atrasadas;
  badge.textContent = atrasadas;
}

// ------------------------------------------------------------ campanhas

$('#form-campanha').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/campaigns', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    avisar($('#aviso-campanha'), 'Campanha criada. Use o link abaixo no botão do anúncio.');
    e.target.reset();
    carregarRelatorio();
  } catch (err) { avisar($('#aviso-campanha'), err.message, true); }
});

async function carregarRelatorio() {
  const linhas = await api('/report/campaigns');
  const campanhas = await api('/campaigns');
  const todas = [...linhas, ...campanhas.filter((c) => !linhas.some((l) => l.code === c.code)).map((c) => ({ code: c.code, name: c.name, leads: 0, oportunidades: 0, alunos: 0, base_fria: 0 }))];
  const link = (code) => config.whatsapp_numero
    ? `https://wa.me/${config.whatsapp_numero}?text=${encodeURIComponent(`Olá! Quero saber das aulas #${code}`)}`
    : '';
  $('#relatorio').innerHTML = todas.length ? todas.map((c) => `
    <tr>
      <td>${esc(c.code)}<small>${esc(c.name)}</small></td>
      <td>${c.leads}</td><td>${c.oportunidades}</td><td>${c.alunos}</td>
      <td>${c.leads ? Math.round((c.alunos / c.leads) * 100) + '%' : '—'}</td>
      <td>${c.base_fria}</td>
      <td>${c.code === 'ORGANICO' ? '' : link(c.code) ? `<code>${esc(link(c.code))}</code>` : '<small>defina WHATSAPP_NUMERO</small>'}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="vazio">Crie a primeira campanha acima.</td></tr>';
}

// ------------------------------------------------------------ início

config = await api('/config').catch(() => config);
carregarLeads();
atualizarBadge();
