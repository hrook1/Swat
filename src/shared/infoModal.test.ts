import { describe, expect, it } from 'vitest';
import { canDismissInfo, type InfoModalDismissal } from './infoModal';

describe('welcome acknowledgement', () => {
  it('requires Let’s go for the initial welcome', () => {
    expect(canDismissInfo('welcome', 'continue')).toBe(true);
    for (const reason of ['escape', 'backdrop', 'close'] as const)
      expect(canDismissInfo('welcome', reason)).toBe(false);
  });

  it('does not impose the entry gate on reopened help or about', () => {
    const reasons: InfoModalDismissal[] = ['continue', 'escape', 'backdrop', 'close'];
    for (const kind of ['help', 'about'] as const)
      for (const reason of reasons) expect(canDismissInfo(kind, reason)).toBe(true);
  });
});
