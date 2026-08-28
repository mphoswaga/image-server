-- Phase 4 preparation only. Applying this schema does not switch LessonScope
-- away from file storage. All ownership columns are required deliberately.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  educscope_user_id text UNIQUE,
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'teacher',
  organization_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rosters (
  id text NOT NULL,
  teacher_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, id)
);

CREATE TABLE IF NOT EXISTS roster_students (
  teacher_id text NOT NULL,
  roster_id text NOT NULL,
  student_id text NOT NULL,
  display_name text NOT NULL,
  gender text,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (teacher_id, roster_id, student_id),
  FOREIGN KEY (teacher_id, roster_id) REFERENCES rosters(teacher_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stored_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  domain text NOT NULL,
  record_id text NOT NULL,
  object_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planning_assets (
  id text NOT NULL,
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  grade text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT false,
  object_id uuid REFERENCES stored_objects(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id text PRIMARY KEY,
  teacher_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  roster_id text,
  room_code text NOT NULL UNIQUE,
  assignment_type text NOT NULL,
  title text NOT NULL,
  content jsonb NOT NULL,
  cutoff_at timestamptz,
  results_released boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  payload jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS practice_attempts (
  id text PRIMARY KEY,
  student_id text NOT NULL,
  teacher_id text REFERENCES app_users(id) ON DELETE SET NULL,
  activity_id text NOT NULL,
  activity_version integer NOT NULL,
  status text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  mistakes integer NOT NULL DEFAULT 0,
  active_seconds integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS practice_attempts_student_activity_idx
  ON practice_attempts(student_id, activity_id, activity_version, status);

CREATE TABLE IF NOT EXISTS live_rooms (
  code text PRIMARY KEY,
  teacher_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  roster_id text,
  status text NOT NULL,
  mode text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_room_participants (
  room_code text NOT NULL REFERENCES live_rooms(code) ON DELETE CASCADE,
  participant_id text NOT NULL,
  student_id text,
  nickname text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  mistakes integer NOT NULL DEFAULT 0,
  active_seconds integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  joined_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_code, participant_id)
);

CREATE TABLE IF NOT EXISTS generated_decks (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL,
  payload jsonb NOT NULL,
  object_id uuid REFERENCES stored_objects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_records (
  source_path text PRIMARY KEY,
  domain text NOT NULL,
  source_sha256 text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);
