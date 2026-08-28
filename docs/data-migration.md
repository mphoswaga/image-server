# Database and Object-Storage Migration

## Current state

LessonScope still reads and writes its existing persistent-volume files. The
Phase 4 preparation code does not connect to PostgreSQL, apply SQL, upload an
object, dual-write, or alter a production request.

The preparation adds:

- `persistence/schema.sql`: ownership-aware PostgreSQL target schema.
- `persistence/contracts.js`: repository and object-store boundaries.
- `persistence/inventory.js`: checksummed classification of current files.
- `npm run data:inventory -- <output.json>`: a repeatable source inventory.

## Domain order

Migrate one domain at a time in this order:

1. Planning asset metadata and uploaded template objects.
2. Rosters and roster students.
3. Assignments, submissions, games, and practice attempts.
4. Live rooms and participants.
5. Generated decks and exported files.
6. Identity data only after the EducScope ID mapping is verified.

Templates come first because their writes are infrequent and easy to compare.
Live rooms come late because they have the highest concurrency risk.

## Required flags for later stages

Future adapters must remain inert unless explicitly enabled:

- `PERSISTENCE_DATABASE_URL`: PostgreSQL connection string.
- `PERSISTENCE_DUAL_WRITE=true`: write to files and PostgreSQL/object storage.
- `PERSISTENCE_READ_DOMAIN=<domain>`: switch one named domain to repository reads.
- `PERSISTENCE_FILE_FALLBACK=true`: permit verified file fallback during observation.

No current code reads these variables. They document the contract for the next
implementation slice and prevent a database URL alone from changing behavior.

## Backfill proof

Before backfill:

```bash
npm run backup -- /secure/location/lessonscope-pre-migration
npm run backup:verify -- /secure/location/lessonscope-pre-migration
npm run data:inventory -- /secure/location/pre-migration-inventory.json
```

Each migrated source path must create one `migration_records` row with its
source checksum and target ID. Verification compares:

- File count and bytes by domain.
- Source SHA-256 against `migration_records.source_sha256`.
- Owner IDs and record IDs.
- Object byte size and checksum.
- Domain-specific counts such as students, submissions, and checkpoints.

## Rollback rule

During dual-write, files remain the production read source. After a domain read
switch, new writes must continue reaching both stores until the observation
period ends. A rollback changes only `PERSISTENCE_READ_DOMAIN`; it must never
discard database writes made after cutover.
