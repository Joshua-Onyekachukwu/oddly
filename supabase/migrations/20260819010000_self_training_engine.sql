-- ODDLY Self-Training Engine Tables
-- Version: 1.0
-- Date: August 19, 2026

-- ============================================
-- TRAINING LOG
-- ============================================

create table training_log (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  training_date date not null,
  predictions_count int,
  correct_count int,
  accuracy decimal(5,4),
  lessons_learned jsonb,
  adjustments_made jsonb,
  feature_weights jsonb,
  market_performance jsonb,
  league_performance jsonb,
  calibration jsonb,
  notes text,
  created_at timestamptz default now()
);

alter table training_log enable row level security;
create policy "Anyone can view training log" on training_log
  for select using (true);
create policy "Admins can manage training log" on training_log
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- FEATURE IMPORTANCE
-- ============================================

create table feature_importance (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  market text,
  feature_name text not null,
  importance decimal(5,4),
  league_id uuid,
  odds_range text,
  sample_size int,
  updated_at timestamptz default now()
);

alter table feature_importance enable row level security;
create policy "Anyone can view feature importance" on feature_importance
  for select using (true);
create policy "Admins can manage feature importance" on feature_importance
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- MODEL LEARNING HISTORY
-- ============================================

create table model_learning_history (
  id uuid primary key default uuid_generate_v4(),
  model_version text not null,
  prediction_id uuid references predictions(id),
  features_snapshot jsonb not null,
  predicted_probability decimal(5,4),
  actual_outcome text,
  actual_score text,
  actual_total_goals int,
  was_correct boolean,
  error_analysis jsonb,
  created_at timestamptz default now()
);

create index idx_learning_version on model_learning_history(model_version);
create index idx_learning_correct on model_learning_history(was_correct);
create index idx_learning_created on model_learning_history(created_at);

alter table model_learning_history enable row level security;
create policy "Anyone can view learning history" on model_learning_history
  for select using (true);
create policy "System can manage learning history" on model_learning_history
  for all using (true);

-- ============================================
-- COMMENTS
-- ============================================

comment on table training_log is 'Every learning cycle recorded - weekly retrains, daily learnings';
comment on table feature_importance is 'Which features matter most for predictions';
comment on table model_learning_history is 'Every prediction-outcome pair with feature snapshots for self-training';
