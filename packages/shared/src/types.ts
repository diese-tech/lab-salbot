export type PendingActionType =
  | "match_result"
  | "reschedule"
  | "admin_review"
  | "alias_change"
  | "roster_trade"
  | "roster_drop";

export type PendingActionStatus =
  "pending" | "pending_info" | "approved" | "denied" | "cancelled";

export type MatchStatus =
  "scheduled" | "live" | "completed" | "postponed" | "forfeit";

export type AuditActionType =
  | "pending_action_created"
  | "pending_action_approved"
  | "pending_action_denied"
  | "pending_action_needs_info"
  | "pending_action_cancelled"
  | "match_result_recorded"
  | "match_rescheduled"
  | "proof_thread_recorded"
  | "stat_approved"
  | "stat_rejected"
  | "stat_corrected"
  | "ign_updated"
  | "discord_identity_linked"
  | "division_role_mapping_updated"
  | "division_role_synced"
  | "captain_role_mapping_updated"
  | "organization_role_mapping_updated"
  | "admin_override";

export type StatRecordStatus =
  "pending" | "approved" | "rejected" | "corrected" | "superseded";

export interface ParsedScore {
  winnerGames: number;
  loserGames: number;
  gamesPlayed: number;
  expectedScreenshots: number;
}

export interface MatchResultPayload {
  winnerOrgId: string;
  score: string;
  parsed: ParsedScore;
}

export interface ReschedulePayload {
  newDate: string;
  newTime: string;
  reason?: string;
}

export interface AdminReviewPayload {
  issueType:
    "score_dispute" | "scheduling_issue" | "eligibility_concern" | "other";
  description: string;
  relatedMatchId?: string;
}

export interface AliasChangePayload {
  targetPlayerId: string;
  oldIgn: string;
  newIgn: string;
  proofScreenshotUrl: string;
}

export interface RosterTradePayload {
  transactionId: string;
  revision: number;
  source:
    "discord_workflow" | "web_workflow" | "manual_reconciliation" | "migration";
}

export interface RosterDropPayload extends RosterTradePayload {
  orgId: string;
  playerId: string;
}
