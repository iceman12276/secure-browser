import { describe, it, expect } from 'vitest';
import { resolveOmnibox } from '../../electron/renderer/src/lib/omnibox';

const SEARCH = 'https://duckduckgo.com/?q=';

describe('resolveOmnibox', () => {
  // The regression: typing a bare word used to become "https://github/" and fail
  // DNS. It must now be a web search, exactly like a real browser omnibox.
  it('treats a bare word as a web search (the github regression)', () => {
    expect(resolveOmnibox('github')).toBe(`${SEARCH}github`);
  });

  it('treats a multi-word phrase as a search', () => {
    expect(resolveOmnibox('how to make sourdough')).toBe(`${SEARCH}how%20to%20make%20sourdough`);
    expect(resolveOmnibox('what is rust?')).toBe(`${SEARCH}what%20is%20rust%3F`);
  });

  it('navigates to a dotted hostname over https', () => {
    expect(resolveOmnibox('github.com')).toBe('https://github.com');
    expect(resolveOmnibox('example.co.uk')).toBe('https://example.co.uk');
  });

  it('keeps the path/query when a hostname has one', () => {
    expect(resolveOmnibox('github.com/anthropics')).toBe('https://github.com/anthropics');
    expect(resolveOmnibox('duckduckgo.com/?q=cats')).toBe('https://duckduckgo.com/?q=cats');
  });

  it('passes through an explicit safe scheme verbatim', () => {
    expect(resolveOmnibox('https://github.com')).toBe('https://github.com');
    expect(resolveOmnibox('http://example.com')).toBe('http://example.com');
    expect(resolveOmnibox('HTTPS://Example.com/Path')).toBe('HTTPS://Example.com/Path');
    expect(resolveOmnibox('about:blank')).toBe('about:blank');
    expect(resolveOmnibox('file:///home/isaac/x.html')).toBe('file:///home/isaac/x.html');
  });

  it('routes localhost and IPv4 to http (dev servers, LAN)', () => {
    expect(resolveOmnibox('localhost:5173')).toBe('http://localhost:5173');
    expect(resolveOmnibox('localhost')).toBe('http://localhost');
    expect(resolveOmnibox('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(resolveOmnibox('192.168.1.10')).toBe('http://192.168.1.10');
  });

  it('does not execute dangerous schemes as URLs — they become searches', () => {
    expect(resolveOmnibox('javascript:alert(1)')).toBe(`${SEARCH}${encodeURIComponent('javascript:alert(1)')}`);
    expect(resolveOmnibox('mailto:a@b.com')).toBe(`${SEARCH}${encodeURIComponent('mailto:a@b.com')}`);
  });

  it('trims whitespace and no-ops on empty input', () => {
    expect(resolveOmnibox('  github.com  ')).toBe('https://github.com');
    expect(resolveOmnibox('   ')).toBe('');
    expect(resolveOmnibox('')).toBe('');
  });
});
