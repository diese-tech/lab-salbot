export type PendingActionType = 'match_result' | 'reschedule' | 'admin_review' | 'alias_change';

export type PendingActionStatus =
  | 'pending'
  | 'pending_info'
  | 'approved'
  | 'denied'
  | 'cancelled';

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'completed'
  | 'postponed'
  | 'forfeit';

export type AuditActionType =
  | 'pending_action_created'
  | 'pending_action_approved'
  | 'pending_action_denied'
  | 'pending_action_needs_info'
  | 'pending_action_cancelled'
  | 'match_result_recorded'
  | 'match_rescheduled'
  | 'stat_approved'
  | 'stat_rejected'
  | 'stat_corrected'
  | 'ign_updated'
  | 'discord_identity_linked'
  | 'division_role_mapping_updated'
  | 'division_role_synced'
  | 'admin_override';

export type StatRecordStatus = 'pending' | 'approved' | 'rejected' | 'corrected' | 'superseded';

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
  issueType: 'score_dispute' | 'scheduling_issue' | 'eligibility_concern' | 'other';
  description: string;
  relatedMatchId?: string;
}

export interface AliasChangePayload {
  targetPlayerId: string;
  oldIgn: string;
  newIgn: string;
  proofScreenshotUrl: string;
}
