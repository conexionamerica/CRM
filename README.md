# CRM de leads · Conexión América (MVP)

Painel para o atendente acompanhar o funil **anúncio no Instagram → contato no WhatsApp → oportunidade → aluno**, com quem não contrata ficando na base como lead frio. Roda inteiro na Cloudflare (Workers + D1), dentro do plano gratuito, atendendo à restrição de infraestrutura serverless de baixo custo (RES02).

## O que o MVP faz (faixa verde do story map)

| História | O que entrega | Onde está |
|---|---|---|
| US-00 · origem da campanha | Cadastro de campanhas com código (ex.: `IG-OUT26`) e link do WhatsApp pronto para o anúncio | `POST /api/campaigns`, aba Campanhas |
| US-01 · lead sem duplicar | Todo contato vira lead; o telefone é único. Quem volta a escrever ganha um registro de "retorno" no mesmo lead, e o lead frio volta para a fila | `POST /api/leads`, webhook do WhatsApp |
| US-03 · dados para descobrir o lead quente | O atendente registra idioma, objetivo, urgência, nível, empresa e disponibilidade, além da hora da primeira resposta. A temperatura é só um palpite opcional, para comparar depois com quem fechou. A fila mostra primeiro quem ainda espera resposta | `PATCH /api/leads/:id`, `POST /api/leads/:id/replied`, ficha do lead |
| US-02 · oportunidade e falta | Agendar a aula experimental transforma o lead em oportunidade. Reagendar substitui a aula anterior. Se a aula passa sem presença, o Cron marca "faltou" e cria a tarefa de retomar o contato em até 12h | `POST /api/leads/:id/trials`, `scheduled()`, aba Tarefas |
| US-04 · vira aluno | Cria a conta de aluno com idioma e pacote, e fecha as tarefas abertas | `POST /api/leads/:id/convert` |
| US-05 · resultado por campanha | Leads, oportunidades, alunos, conversão e base fria por campanha | `GET /api/report/campaigns`, aba Campanhas |
| Análise do grupo | Planilha (CSV) com uma linha por lead: origem, triagem, tempo até a primeira resposta, faltas, tentativas, desfecho e motivo de não fechar. Nome e telefone ficam de fora (LGPD) | `GET /api/export/leads.csv`, botão na Fila |

**Regra confirmada:** depois de 3 tentativas de contato sem resposta, a oportunidade vira lead frio (motivo "sem resposta"). O número fica em `MAX_TENTATIVAS` no `wrangler.jsonc`.

**Por que não há critério de lead quente:** descobrir esse critério é o objetivo do trabalho. O MVP coleta os dados e o desfecho de cada lead, e a análise da planilha vai definir a regra numa versão seguinte.

**Crédito da campanha:** o lead fica com a primeira campanha que o trouxe. Se ele voltar por outra campanha, o retorno fica registrado no histórico com o código novo.

## Como o lead entra

1. **Sem depender da Meta (já funciona):** cada anúncio usa o link `https://wa.me/<número>?text=Olá! Quero saber das aulas #IG-OUT26`. O atendente cola o telefone e a primeira mensagem no painel, e o sistema lê o código da campanha.
2. **Com a API oficial do WhatsApp (Cloud API):** ao cadastrar o webhook `https://<seu-worker>/webhook/whatsapp`, todo contato vira lead sozinho. Em anúncios Click-to-WhatsApp, a Meta envia o id do anúncio, e o sistema liga o lead à campanha que tem esse "ID do anúncio na Meta".

## Instalar

Pré-requisitos: Node 20 ou mais novo e uma conta gratuita na Cloudflare.

```bash
npm install
npx wrangler login
npx wrangler d1 create conexion-crm      # copie o database_id para o wrangler.jsonc
npm run db:remote                         # cria as tabelas no D1
npx wrangler deploy
```

Depois, no `wrangler.jsonc`, troque `WHATSAPP_NUMERO` pelo número da escola e rode `npx wrangler deploy` de novo.

**Proteja o painel antes de usar com dados reais.** No painel da Cloudflare, em Zero Trust → Access → Applications, crie uma aplicação para o domínio do Worker liberando só os e-mails da equipe (gratuito até 50 pessoas). Deixe o caminho `/webhook/whatsapp` fora da regra, porque quem chama é a Meta.

Para o webhook da Cloud API, configure os segredos:

```bash
npx wrangler secret put WHATSAPP_VERIFY_TOKEN   # o mesmo texto que você digitar na Meta
npx wrangler secret put WHATSAPP_APP_SECRET     # "App secret" do app na Meta, valida a assinatura
```

## Rodar e testar no computador

```bash
npm install
npm run db:local
npm run dev            # abre em http://localhost:8787
npm run smoke          # em outro terminal: percorre o funil inteiro e confere cada história
```

`POST /api/cron/run` dispara na hora a mesma rotina do Cron, útil para testar a falta.

## Estrutura

```
migrations/0001_inicial.sql   tabelas: campaigns, leads, contacts, trial_classes, tasks, students
migrations/0002_dados_para_analise.sql   urgência, nível, empresa, disponibilidade, primeira resposta, motivo de perda
src/index.js                  API, webhook do WhatsApp e rotina do Cron
public/                       painel do atendente (HTML, CSS e JS, sem framework)
scripts/smoke.sh              teste de ponta a ponta das histórias do MVP
```

## Fora deste MVP (Versão 2 do story map)

Agente de IA que faz até 3 perguntas e classifica o lead (RES01, bot com no máximo 3 perguntas), respostas prontas no WhatsApp (RNF01, templates de resposta), cobrança recorrente e nota fiscal pelo Asaas (RF04), e origem de LinkedIn, Facebook e Google.

## Protótipo navegável

`docs/prototipo.html` é o mesmo painel com dados de exemplo e a API simulada no navegador. Abra o arquivo direto no navegador para apresentar o fluxo, sem instalar nada. Nada é salvo.
