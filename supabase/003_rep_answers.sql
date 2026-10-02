-- Rep answers to the integrity agent's questions, kept with the analysis for audit.
-- Shape: [{ index, question, field, record_index, answer, answered_at }]
alter table deal_analyses add column if not exists rep_answers jsonb;
notify pgrst, 'reload schema';
