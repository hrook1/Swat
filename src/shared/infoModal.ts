export type InfoModalKind = 'welcome' | 'help' | 'about';
export type InfoModalDismissal = 'continue' | 'escape' | 'backdrop' | 'close';

/** Initial instructions require acknowledgement; reopened dialogs are ordinary help. */
export function canDismissInfo(kind: InfoModalKind, reason: InfoModalDismissal): boolean {
  return kind !== 'welcome' || reason === 'continue';
}
