#!/usr/bin/env bash
# Teste de fumaça do funil completo contra um "wrangler dev" rodando (padrão: http://localhost:8787).
# Uso: npm run db:local && npm run dev   (em outro terminal)   e depois: bash scripts/smoke.sh
set -euo pipefail
BASE="${1:-http://localhost:8787}"
call() { curl -sS -X "$1" "$BASE$2" -H 'content-type: application/json' ${3:+-d "$3"}; echo; }
check() { if echo "$2" | grep -q "$3"; then echo "  ok: $1"; else echo "  FALHOU: $1 -> $2"; exit 1; fi; }

echo "US-00 campanha"
check "cria campanha" "$(call POST /api/campaigns '{"code":"IG-TESTE","name":"Stories teste"}')" '"code":"IG-TESTE"'

echo "US-01 lead sem duplicar"
check "lead da campanha" "$(call POST /api/leads '{"phone":"(11) 98888-7777","name":"Ana","message":"Oi! #ig-teste"}')" '"campanha":"IG-TESTE"'
check "mesmo número não duplica" "$(call POST /api/leads '{"phone":"5511988887777","message":"voltei"}')" '"novo":false'
check "orgânico" "$(call POST /api/leads '{"phone":"21977776666","name":"Bruno"}')" '"campanha":null'
ID=$(call GET '/api/leads?q=Ana' | sed -E 's/.*"id":([0-9]+).*/\1/;q')

echo "US-03 dados da triagem para análise"
check "registra triagem" "$(call PATCH /api/leads/$ID '{"language":"espanhol","goal":"profissional","urgency":"agora","company":"Acme"}')" '"urgency":"agora"'
check "fila mostra quem aguarda resposta primeiro" "$(call GET /api/leads)" '^\[{"id":1,'
check "primeira resposta" "$(call POST /api/leads/$ID/replied)" '"first_reply_at"'

echo "US-02 aula experimental e falta"
check "agenda e vira oportunidade" "$(call POST /api/leads/$ID/trials '{"teacher":"Lucía","scheduled_at":"2026-01-10T13:00:00Z"}')" '"status":"agendada"'
check "etapa oportunidade" "$(call GET /api/leads/$ID)" '"stage":"oportunidade"'
check "cron marca falta" "$(call POST /api/cron/run)" '"faltas":1'
check "tarefa em 12h" "$(call GET /api/tasks)" '"due_at":"2026-01-11T01:00:00Z"'
TASK=$(call GET /api/tasks | sed -E 's/.*"id":([0-9]+).*/\1/;q')
check "tentativa 1" "$(call POST /api/tasks/$TASK/attempt '{"answered":false}')" '"tentativas":1'

echo "US-04 vira aluno"
check "converte" "$(call POST /api/leads/$ID/convert '{"language":"espanhol","package":"8 aulas/mês"}')" '"ok":true'
check "tarefa fechada" "$(call GET /api/tasks)" '^\[\]'

echo "US-05 relatório"
check "1 aluno na campanha" "$(call GET /api/report/campaigns)" '"code":"IG-TESTE","name":"Stories teste","leads":1,"oportunidades":1,"alunos":1'
check "planilha para análise" "$(curl -sS $BASE/api/export/leads.csv)" 'IG-TESTE,aluno,1,1,espanhol,profissional,agora'
echo "Tudo certo."
