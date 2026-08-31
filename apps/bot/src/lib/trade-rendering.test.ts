import { describe, expect, it } from 'vitest';
import { buildCompletedTradeLine, tradeOperationMarker } from './trade-rendering';

describe('trade rendering', () => {
  it('renders uneven completed trades in the compact mobile-safe format', () => {
    expect(buildCompletedTradeLine({
      divisionId: 'solar', proposerTag: 'FF', receiverTag: 'TC',
      movements: [
        { playerName: 'Crow', fromOrgId: 'ff', toOrgId: 'tc' },
        { playerName: 'Kestrel', fromOrgId: 'ff', toOrgId: 'tc' },
        { playerName: 'The_Expert133', fromOrgId: 'tc', toOrgId: 'ff' },
      ],
      proposerOrgId: 'ff', receiverOrgId: 'tc',
    })).toBe('[SOLAR] FF traded Crow + Kestrel to TC for The_Expert133');
  });

  it('uses a stable operation marker independent of delivery attempts', () => {
    expect(tradeOperationMarker('trade-123')).toBe('sal-operation:trade-123');
  });
});
