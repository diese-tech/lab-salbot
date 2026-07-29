import { parseScore } from "./score";
import type {
  AdminReviewPayload,
  AliasChangePayload,
  MatchResultPayload,
  PendingActionType,
  ReschedulePayload,
} from "./types";

export type PendingActionPayload =
  | MatchResultPayload
  | ReschedulePayload
  | AdminReviewPayload
  | AliasChangePayload;

export function parsePendingActionPayload(
  type: PendingActionType,
  value: unknown,
): PendingActionPayload {
  if (type === "match_result") return parseMatchResultPayload(value);
  if (type === "reschedule") return parseReschedulePayload(value);
  if (type === "admin_review") return parseAdminReviewPayload(value);
  return parseAliasChangePayload(value);
}

export function parseMatchResultPayload(value: unknown): MatchResultPayload {
  const payload = requireObject(value, "match_result payload");
  const winnerOrgId = requireString(payload, "winnerOrgId");
  const score = requireString(payload, "score");
  const parsed = parseScore(score);
  if (!parsed) throw new Error("match_result payload score is invalid.");
  return { winnerOrgId, score, parsed };
}

export function parseReschedulePayload(value: unknown): ReschedulePayload {
  const payload = requireObject(value, "reschedule payload");
  const newDate = requireString(payload, "newDate");
  const newTime = requireString(payload, "newTime");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    throw new Error("reschedule payload newDate must use YYYY-MM-DD.");
  }
  if (!/^\d{2}:\d{2}$/.test(newTime)) {
    throw new Error("reschedule payload newTime must use HH:MM.");
  }
  const reason = optionalString(payload, "reason");
  return { newDate, newTime, ...(reason ? { reason } : {}) };
}

export function parseAdminReviewPayload(value: unknown): AdminReviewPayload {
  const payload = requireObject(value, "admin_review payload");
  const issueType = requireString(payload, "issueType");
  if (
    ![
      "score_dispute",
      "scheduling_issue",
      "eligibility_concern",
      "other",
    ].includes(issueType)
  ) {
    throw new Error("admin_review payload issueType is invalid.");
  }
  const description = requireString(payload, "description");
  const relatedMatchId = optionalString(payload, "relatedMatchId");
  return {
    issueType: issueType as AdminReviewPayload["issueType"],
    description,
    ...(relatedMatchId ? { relatedMatchId } : {}),
  };
}

export function parseAliasChangePayload(value: unknown): AliasChangePayload {
  const payload = requireObject(value, "alias_change payload");
  return {
    targetPlayerId: requireString(payload, "targetPlayerId"),
    oldIgn: requireString(payload, "oldIgn"),
    newIgn: requireString(payload, "newIgn"),
    proofScreenshotUrl: requireString(payload, "proofScreenshotUrl"),
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(`JSON payload ${key} must be a non-empty string.`);
  }
  return field;
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  if (field === undefined || field === null || field === "") return undefined;
  if (typeof field !== "string") {
    throw new Error(`JSON payload ${key} must be a string when present.`);
  }
  return field;
}
