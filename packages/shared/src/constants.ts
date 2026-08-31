export const STATUS_EMOJI = {
  pending: '📝',
  awaiting_proof: '📸',
  pending_info: '⚠️',
  approved: '✅',
  denied: '❌',
  revised: '🔁',
} as const;

export const SCREENSHOTS_PER_GAME = 1;

export const CONFIDENCE_THRESHOLDS = {
  standard: 0.85,
  flagged: 0.60,
} as const;
