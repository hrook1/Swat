import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';
import { InfoModal } from './components/InfoModal';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());

describe('minimal game toolbar', () => {
  it('keeps only Help in the toolbar without removing the game or export controls', () => {
    vi.stubGlobal('location', { search: '?seed=34' });
    const markup = renderToStaticMarkup(<App />);
    const toolbar = markup.match(/<div class="arena-tools">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect([...toolbar.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'How to play',
    ]);
    expect(toolbar.match(/<button/g)).toHaveLength(1);
    for (const removed of ['Share', 'Enable sound', 'Mute sound', 'Expand game'])
      expect(markup).not.toContain(`aria-label="${removed}"`);
    for (const kept of [
      'Swat home',
      'Reset game',
      'Pause game',
      'Record clip',
      'Snapshot',
      'Tiny mind',
    ])
      expect(markup).toContain(kept);
    expect(markup).not.toContain('is-expanded');
  });

  it('omits the decorative deck/system/live tags without removing useful feedback', () => {
    vi.stubGlobal('location', { search: '?seed=34' });
    const markup = renderToStaticMarkup(<App />);
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    for (const tag of ['arena-label', 'live-tag', 'all-on', 'status-dot']) {
      expect(markup).not.toContain(tag);
      expect(source).not.toContain(tag);
      expect(css).not.toContain(tag);
    }
    for (const text of ['FLIGHT DECK', 'All systems on', "'LIVE'"])
      expect(source).not.toContain(text);
    for (const kept of [
      'Tiny mind',
      'neurons',
      'real connections',
      'How to play',
      'Loading circuit',
    ])
      expect(markup).toContain(kept);
    for (const feedback of ['replay-badge', 'brain-loading', 'error-overlay', 'pause-overlay'])
      expect(source).toContain(feedback);
  });

  it('opens welcome instructions on every fresh page entry with one enabled entry action', () => {
    vi.stubGlobal('location', { search: '?seed=34' });
    for (let visit = 0; visit < 2; visit++) {
      const markup = renderToStaticMarkup(<App />);
      const dialog = markup.match(/<dialog[\s\S]*?<\/dialog>/)?.[0] ?? '';
      expect(dialog).toContain('Welcome to Swat.');
      expect(dialog).toContain('Let’s go');
      expect(dialog.match(/<button/g)).toHaveLength(1);
      expect(dialog).not.toContain('disabled');
      expect(dialog).not.toContain('Close dialog');
      expect(dialog).toContain('tabindex="-1"');
      expect(dialog).toContain('closedby="none"');
      expect(markup).toContain('Swat. Catch it, if you can.');
      expect(markup).not.toContain('Fruitfly');
    }
  });

  it('keeps reopened help and about dialogs normally dismissible', () => {
    for (const kind of ['help', 'about'] as const) {
      const markup = renderToStaticMarkup(
        <InfoModal kind={kind} circuit={null} onClose={() => {}} />,
      );
      expect(markup).toContain('Close dialog');
      expect(markup).toContain('closedby="closerequest"');
      expect(markup).not.toContain('Welcome to Swat.');
      if (kind === 'help') expect(markup).toContain('Let’s go');
    }
  });

  it('explains swatter sensing and visible neural reactions in both welcome and help', () => {
    for (const kind of ['welcome', 'help'] as const) {
      const markup = renderToStaticMarkup(
        <InfoModal kind={kind} circuit={null} onClose={() => {}} />,
      );
      expect(markup).toContain('Watch Tiny mind.');
      expect(markup).toContain('During play, the fly uses simulated vision to sense your swatter.');
      expect(markup).toContain('neurons can light up as it reacts—even before you click.');
      expect(markup).toContain('Let’s go');
    }
  });

  it('uses Swat for browser titles and export branding without moving the site', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    expect(html.match(/Swat — Catch it\. If you can\./g)).toHaveLength(3);
    expect(html).toContain('https://fruitfly-tiny-brain.vercel.app/');
    expect(source).toContain("ctx.fillText('Swat.'");
    expect(source).toContain('swat-snapshot.png');
    expect(source).toContain('swat-replay.');
    expect(source).not.toContain('fruitfly');
  });
});
