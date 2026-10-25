-- O critério de lead quente ainda não existe: o grupo vai descobri-lo analisando os dados.
-- Por isso o MVP guarda mais dados da triagem e do atendimento, e a temperatura vira só um palpite opcional
-- do atendente (útil depois para comparar o palpite com quem realmente fechou).
ALTER TABLE leads ADD COLUMN urgency TEXT CHECK (urgency IN ('agora','ate_1_mes','sem_pressa'));
ALTER TABLE leads ADD COLUMN level TEXT CHECK (level IN ('iniciante','intermediario','avancado'));
ALTER TABLE leads ADD COLUMN company TEXT;          -- empresa, quando o objetivo é profissional
ALTER TABLE leads ADD COLUMN availability TEXT;     -- dias e turnos em que pode ter aula
ALTER TABLE leads ADD COLUMN first_reply_at TEXT;   -- quando o atendente respondeu pela primeira vez
ALTER TABLE leads ADD COLUMN lost_reason TEXT;      -- por que não fechou (preço, horário, sem resposta...)
