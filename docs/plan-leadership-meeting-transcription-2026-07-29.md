# Leadership Meeting Transcription Implementation Plan

**Issue:** [#60](https://github.com/diese-tech/lab-salbot/issues/60)

**Prepared:** 2026-07-29

**Status:** plan only; no recording implementation is authorized by this document

## Recommendation

Build this as two deployable components with a shared, provider-neutral meeting
engine:

1. SALBot owns commands, authorization, consent, Discord voice capture,
   attendance events, durable chunk upload, and publishing.
2. A separate local transcription worker owns audio decoding, Whisper,
   transcript merging, minutes extraction, retention, and retryable processing.

Do not run Whisper inside the singleton Railway Discord process. CPU-heavy
transcription would compete with gateway heartbeats and the operation-outbox
worker, while a bot redeploy could destroy the only local copy of a recording.

The initial local-worker target may be `grid-node-01`, but only after a benchmark
and runtime preparation. The 2026-07-29 read-only inspection found 4 CPU cores,
7.1 GiB RAM with about 1.8 GiB available, no detected GPU, no `ffmpeg`, no
Whisper executable, and Python 3.14. That host is not ready for OpenAI Whisper
as-is: the upstream project documents Python 3.8-3.11 and requires `ffmpeg`.
Use a pinned Python 3.11 container or benchmark a quantized `whisper.cpp`
adapter; do not alter the host Python installation.

## Current-state findings

- SALBot has no voice dependency, meeting command, audio pipeline, meeting
  engine, transcription provider, or meeting schema.
- `sal-database` db-v1.5.0 has no meeting, transcript, attendance, or action-item
  tables.
- SALBot is one Railway singleton with a 30-second drain window. It now exposes
  truthful readiness and has a durable database outbox, but that outbox claim
  function is not topic-filtered. A transcription worker must not consume the
  same queue or SALBot will lease and reject transcription jobs it cannot run.
- `@discordjs/voice` supports receive streams and per-user subscriptions, but
  Discord does not document audio receive as a stable bot API. A spike is a
  release gate, not an optional task.
- Discord voice requires UDP connectivity and DAVE/E2EE support. The selected
  library version and Railway environment must pass an actual receive test.

## Scope

### MVP

- `/meeting start`, `/meeting stop`, `/meeting status`, `/meeting cancel`
- one active leadership meeting per Discord guild
- per-speaker audio chunks keyed by Discord user ID
- join, leave, reconnect, consent, and cumulative attendance tracking
- local Whisper transcription through a replaceable adapter
- chronological Markdown transcript with speaker labels and attendance events
- structured recap with populated Decisions, Action Items, and Open Items only
- compact Discord recap plus attached transcript
- immediate raw-audio deletion after successful publication
- restart-safe processing, bounded retries, and operator-visible failure state

### Explicitly out of scope

- live captions
- recording non-consenting participants
- searchable long-term audio archives
- editing the transcript or minutes in Discord
- action-item workflow, reminders, or completion tracking
- cross-guild tenancy beyond explicit guild IDs
- automatic meeting start from voice activity

## Safety and permissions

- Restrict start, stop, and cancel to canonical `admin_users` identities for the
  MVP. A Discord role alone must not grant recording authority.
- Require the host to be present in the target voice channel.
- Post a public recording notice before subscribing to audio.
- Require explicit per-participant consent. Audio from a user is discarded
  until consent is recorded; `/meeting status` lists pending participants.
- A new participant pauses their own capture until they consent. Declining or
  timing out excludes that participant without blocking the meeting.
- Record consent and withdrawal as immutable attendance events.
- Never include credentials, signed storage URLs, raw provider responses, or
  private processing errors in the public recap.
- Treat the transcript as sensitive leadership data. Use a private storage
  bucket and short-lived signed reads only.

The consent and retention policy must be reviewed against the jurisdictions of
actual participants before production use. The recommended explicit-consent
default is intentionally stricter than host attestation.

## Data model

Create one canonical migration in `diese-tech/sal-database`; all primary and
foreign IDs remain `text`.

### `leadership_meetings`

- `id text primary key default gen_random_uuid()::text`
- `guild_id`, `voice_channel_id`, `output_channel_id` as Discord snowflake text
- `host_discord_id`, `stopped_by_discord_id`
- `status` check: `starting`, `recording`, `stopping`, `queued`, `transcribing`,
  `summarizing`, `publishing`, `published`, `cancelled`, `interrupted`, `failed`
- `started_at`, `stopped_at`, `published_at`, `heartbeat_at`
- `start_interaction_id text unique` for command idempotency
- `recap_json jsonb` with a versioned runtime-validated schema
- `transcript_artifact_id text`, `discord_message_id text`
- `failure_code text`, `failure_summary text`, `attempts integer`
- timestamps and a partial unique index allowing one active meeting per guild

Do not store a full transcript or raw audio in this row.

### `leadership_meeting_participants`

- `meeting_id`, `discord_user_id` composite unique key
- display-name snapshot
- `consented_at`, `consent_withdrawn_at`
- `first_joined_at`, `last_left_at`, `total_attendance_ms`
- first/last audio chunk ordinal

This table is the query-friendly attendance summary. Cumulative duration is
also recomputed from immutable events before publication.

### `leadership_meeting_attendance_events`

- text ID, meeting ID, Discord user ID
- event type: `joined`, `left`, `reconnected`, `consented`, `withdrew_consent`
- occurred timestamp and meeting-relative millisecond offset
- display-name snapshot and optional non-sensitive reason code

The timeline renderer merges these events with transcript segments.

### `leadership_meeting_artifacts`

- text ID and meeting ID
- optional speaker Discord ID and chunk ordinal
- kind: `speaker_audio_chunk`, `speaker_transcript`, `merged_transcript`
- private storage path, SHA-256, byte size, media type
- meeting-relative start/end milliseconds
- state: `uploading`, `ready`, `processing`, `published`, `deleted`, `failed`
- created, uploaded, deleted, and purge-due timestamps

Raw audio paths are nulled after verified deletion; checksum and deletion audit
metadata remain.

### `leadership_meeting_jobs`

- text ID and unique meeting ID
- state: `pending`, `processing`, `retry`, `completed`, `dead_letter`
- attempt count, available time, lease owner/expiry, last safe error code
- created/updated/completed timestamps

Use a dedicated lease RPC with `FOR UPDATE SKIP LOCKED`, 60-second leases,
jittered backoff, and a bounded dead-letter threshold. Do not reuse the current
unfiltered `operation_outbox` claim function.

### Minutes and action items

Keep MVP decisions, action items, and open items inside versioned `recap_json`.
They are publication output, not yet an operational task system. Normalize
action items into a separate table only when SAL needs assignment, due dates,
status changes, reminders, or cross-meeting reporting.

## Storage and retention

Create a private `leadership-meeting-artifacts` bucket.

- Upload encrypted-in-transit per-speaker Opus chunks every 30-60 seconds so a
  bot restart loses at most one chunk.
- Delete local Railway temp files immediately after checksum-verified upload.
- Delete all raw audio and per-speaker transcript intermediates immediately
  after the final Markdown attachment is posted successfully.
- On failure or interruption, retain raw audio for at most 24 hours for an
  authorized retry, then purge automatically.
- Retain the private merged Markdown transcript for 90 days by default, then
  purge it; the Discord attachment follows Discord's own retention behavior.
- Retain the compact `recap_json`, attendance summary, audit events, hashes, and
  deletion timestamps unless league policy requires a shorter period.
- `/meeting cancel` deletes captured audio promptly and publishes no transcript.

Retention values should be configuration with these defaults, not hard-coded
policy hidden in worker code.

## Component boundaries

### SALBot adapter

- command definitions and `admin_users` authorization
- voice connection and DAVE-capable receive setup
- consent controls and host-only stop/cancel controls
- per-user Opus chunk capture and checksummed upload
- heartbeat and attendance event writes through service RPCs
- durable final recap/attachment publication with a stable marker

### `packages/meeting-engine`

- meeting state machine
- attendance interval accumulation
- chunk manifest and checksum validation
- timestamp normalization and chronological merge
- versioned recap schema
- Markdown transcript and compact recap rendering
- provider interfaces; no Discord or Supabase globals

### Local transcription worker

- dedicated job lease loop
- private artifact download and Opus-to-PCM conversion
- `TranscriptionProvider` adapter (`whisper.cpp` or pinned Python 3.11 Whisper)
- per-segment timestamps and confidence metadata
- restart-safe intermediate manifests
- recap provider call, publication enqueue, and retention cleanup

### Notes provider

Add the task key `meeting-minutes` and `OPENROUTER_MODEL_MEETING_NOTES` through
the existing model router pattern. Sending a leadership transcript to a hosted
provider must be a separate, explicit policy decision. If external processing
is disabled, publish the transcript and a deterministic attendance summary,
then mark AI minutes unavailable rather than silently exporting the text.

## Processing state machine

1. **Start:** validate host, active-meeting uniqueness, voice membership, output
   channel, and consent policy; create the meeting transactionally.
2. **Record:** join voice, capture consented users into rolling chunks, persist
   attendance events and a 15-second heartbeat.
3. **Stop:** stop new subscriptions, flush/upload chunks, close attendance
   intervals, and enqueue one idempotent processing job.
4. **Transcribe:** lease the job, verify all hashes, decode each speaker stream,
   and transcribe with meeting-relative timestamps.
5. **Merge:** combine speaker segments and attendance events chronologically;
   preserve overlapping speech instead of dropping one speaker.
6. **Summarize:** validate structured Decisions, Action Items, and Open Items;
   omit empty sections.
7. **Publish:** reconcile the stable meeting marker, post one recap, attach the
   Markdown transcript, and store the Discord message ID.
8. **Purge:** verify publication, delete raw/intermediate artifacts, write
   deletion audits, and mark the job complete.

## Failure recovery

- Command retries use Discord interaction IDs and return the existing meeting.
- Chunk uploads are idempotent on `(meeting_id, speaker_id, ordinal)` and SHA.
- A bot crash marks a stale heartbeat meeting `interrupted`; uploaded chunks
  remain processable as a clearly labeled partial transcript. Automatic live
  recording resume is out of MVP scope.
- A worker crash leaves a lease that another worker reclaims after expiry.
- Publication checks the stable marker before creating a message, then stores
  the discovered or created Discord message ID.
- A crash after publication but before purge reuses the publication and resumes
  deletion without posting twice.
- Cancellation is terminal and idempotent. It revokes pending jobs and purges
  artifacts; it never races publication without a database state check.

## Delivery sequence

### Gate 0: feasibility spike

- Pin a DAVE-capable `@discordjs/voice` version and required Opus dependency.
- Prove per-user receive, speaker mapping, join/leave events, and UDP behavior in
  a disposable Discord voice channel on the intended Railway service.
- Benchmark 10 minutes of representative multi-speaker audio on
  `grid-node-01` with a pinned local runtime. Target transcription completion
  within 2x recording duration and memory below the worker limit.
- Stop if receive reliability, DAVE compatibility, consent UX, or CPU capacity
  fails. Do not create production meeting tables before this gate passes.

### Wave 1: database contract

- Add tables, constraints, private bucket policy, service RPCs, lease RPCs, RLS,
  retention metadata, and pgTAP concurrency/rollback tests in `sal-database`.
- Publish a protected immutable database release.
- Pin generated types and runtime JSON validation in SALBot.

### Wave 2: reusable engine and worker

- Add `packages/meeting-engine` with deterministic state, attendance, merge,
  rendering, and schema tests.
- Deploy the local worker separately with resource limits, health reporting,
  private credentials, and a purge scheduler.

### Wave 3: Discord capture

- Implement and register commands, consent panel, voice receive, rolling chunk
  upload, heartbeat, status, stop, and cancel.
- Ensure SALBot readiness becomes non-ready if an active recording cannot write
  durable chunks, but do not make idle transcription-worker availability block
  unrelated bot commands.

### Wave 4: recap and publication

- Add the notes adapter and privacy switch.
- Publish through a stable meeting marker and store delivery evidence.
- Implement immediate raw-audio purge and the 24-hour failure purge.

### Wave 5: staging acceptance

- Run a consented 10-minute meeting with reconnects, overlapping speakers, a
  worker restart, and a bot redeploy.
- Verify cumulative attendance, chronological transcript, populated-only recap,
  exactly one Discord post, raw-audio deletion, and no credential/raw-error
  leakage.

## Test matrix

- state transitions, duplicate start/stop/cancel, and one-active-meeting guard
- consent before capture, withdrawal, late join, leave/reconnect, display-name
  changes, and cumulative attendance
- packet loss, silence boundaries, overlapping speech, corrupt/duplicate/missing
  chunks, checksum mismatch, and out-of-order uploads
- worker claim exclusion, expired lease recovery, bounded retry/dead-letter,
  restart after transcription/publication, and concurrent cancellation
- transcript schema rejection, notes-provider timeout, external-processing-off
  fallback, populated-only sections, and Markdown escaping
- raw-audio purge after success/cancel/TTL, private bucket authorization, and
  rollback on audit/job enqueue failure
- Discord voice disconnect, host disconnect, bot redeploy, DAVE negotiation,
  UDP reachability, attachment-size limits, and stable-marker reconciliation

## Rollback

- Disable meeting commands with one feature flag before rolling back code.
- Stop new recordings; allow already queued jobs to finish or cancel them
  explicitly through the service RPC.
- Roll back the bot and worker independently; neither may delete canonical
  meeting rows as part of deploy rollback.
- Keep additive tables during rollback. Remove them only in a later migration
  after artifact purge and an exported audit check.

## Recommended defaults requiring owner confirmation before production

- authorization: `admin_users` only
- consent: explicit per-participant opt-in
- raw audio: delete after success; 24-hour failure TTL
- merged transcript: private storage for 90 days plus Discord attachment
- hosted notes provider: disabled until leadership approves transcript export
- local model: select only after the Gate 0 benchmark

## Source constraints

- [discord.js voice package](https://discord.js.org/docs/packages/voice/stable)
  documents receive support but warns that Discord does not document it as a
  stable API.
- [Discord voice documentation](https://docs.discord.com/developers/topics/voice-connections)
  requires UDP connectivity and current DAVE/E2EE support.
- [OpenAI Whisper setup](https://github.com/openai/whisper/blob/main/README.md)
  requires `ffmpeg` and documents its expected Python range.
