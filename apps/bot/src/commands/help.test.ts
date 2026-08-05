import { describe, expect, it, vi } from 'vitest';
import { execute } from './help';

describe('/help registered command surface', () => {
  it('omits placeholder and planned-only commands', async () => {
    const reply = vi.fn();

    await execute({ reply } as never);

    const embed = reply.mock.calls[0]?.[0]?.embeds?.[0]?.toJSON();
    expect(embed?.description).not.toContain('/rules');
    expect(embed?.description).not.toContain('/trade');
    expect(embed?.description).not.toContain('/claim');
    expect(embed?.description).toContain('/update-ign');
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });
});
