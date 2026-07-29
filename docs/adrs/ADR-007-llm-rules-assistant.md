# ADR-007 — LLM Rules Assistant via OpenRouter

**Date:** 2025-05-21
**Status:** Accepted

---

## Context

Captains frequently ask rules questions in Discord, requiring admin time to answer the same
questions repeatedly. A bot command backed by an LLM would give instant, consistent answers
grounded in the official ruleset without adding admin load.

An LLM is appropriate here because:
- Rules questions are read-only (no mutation, no audit trail required)
- The ruleset is finite and admin-authored
- The failure mode (wrong answer) is low-stakes: a disclaimer directs captains to open a ticket

---

## Decision

Integrate OpenRouter as a single API endpoint for LLM access. Add a `/rules` bot command
that queries an LLM over the full SAL ruleset.

The ruleset is stored as two markdown files in the repository:
- `docs/rules/ruleset.md` — the canonical rulebook (admin-authored)
- `docs/rules/edge-cases.md` — Q&A rulings on situations as they arise

The full content of both files is loaded at startup and injected into the LLM system prompt
on every query ("stuffed context"). No vector database or embedding pipeline.

---

## Why stuffed context over vector RAG

Vector RAG (embed rule chunks → store in pgvector → retrieve top-k on query) adds:
- An embedding pipeline that must re-run whenever rules change
- A retrieval step that can miss relevant rules if they're phrased differently
- pgvector dependency and operational complexity

A league rulebook is small (order of thousands of tokens). Modern LLMs have 100k–1M token
context windows. Stuffing the entire ruleset is simpler, cheaper (prompt caching makes
repeat queries near-free), and strictly more accurate (no retrieval misses).

Revisit this decision if the ruleset ever approaches 50k tokens.

---

## Anti-hallucination contract

The system prompt instructs the model to:
1. Answer ONLY from the provided ruleset
2. State clearly if a topic isn't covered, and direct the captain to an admin ticket
3. Cite the relevant section heading
4. Include the disclaimer: "Admin rulings are final and may override this answer"

Answers are always delivered as ephemeral replies (visible only to the invoker) to prevent
an advisory answer from being mistaken for an official ruling.

---

## Architecture boundaries

| Rule | Held? |
|---|---|
| No mutations on LLM path | ✅ `/rules` is read-only. No pending_action, no audit_log. |
| Human-in-the-loop for authoritative decisions | ✅ Answers are advisory with explicit disclaimer |
| Supabase is the state | ✅ Ruleset lives in the repo, not in bot memory |
| No speculative architecture | ✅ OpenRouter client lives in apps/bot; no shared package until there's a second consumer |

---

## Consequences

- `OPENROUTER_API_KEY` is required in production for `/rules` to function;
  `OPENROUTER_MODEL_RULES` selects its text model and falls back to the legacy
  `OPENROUTER_MODEL`, then the committed default
- The command degrades gracefully if the key is missing (ephemeral error)
- Admins maintain the ruleset by editing `docs/rules/ruleset.md` and `docs/rules/edge-cases.md`
- Cost is bounded: the ruleset is static, so OpenRouter prompt caching applies on supported models
- If a rule is contested, admins have final say — this command is a convenience, not an authority

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Vector RAG with pgvector | Unnecessary complexity at rulebook scale; retrieval misses are worse than no retrieval |
| Hardcoded Q&A responses | Can't handle novel questions; requires code changes for every new rule |
| Admin FAQ channel | Doesn't scale; admins still answer the same questions |
| Gemini API directly | OpenRouter is already the integration point; single key, model-agnostic |
