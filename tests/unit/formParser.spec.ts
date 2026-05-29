import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { detectForms } from '../../electron/content/formParser';

function doc(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('detectForms', () => {
  it('detects a basic login form (username + password)', () => {
    const d = doc(`
      <form>
        <input type="text" name="user" id="user" />
        <input type="password" name="pass" id="pass" />
        <button type="submit">Log in</button>
      </form>`);
    const forms = detectForms(d);
    expect(forms).toHaveLength(1);
    expect(forms[0].kind).toBe('login');
    expect(forms[0].passwordSelector).toBe('#pass');
    expect(forms[0].usernameSelector).toBe('#user');
  });

  it('uses email input as the username field', () => {
    const d = doc(`
      <form>
        <input type="email" id="email" />
        <input type="password" id="pw" />
      </form>`);
    const forms = detectForms(d);
    expect(forms[0].usernameSelector).toBe('#email');
  });

  it('classifies two password fields as a signup form', () => {
    const d = doc(`
      <form>
        <input type="email" id="email" />
        <input type="password" id="pw1" />
        <input type="password" id="pw2" />
      </form>`);
    const forms = detectForms(d);
    expect(forms[0].kind).toBe('signup');
  });

  it('ignores forms with no password field', () => {
    const d = doc(`<form><input type="text" id="q" /><button>Search</button></form>`);
    expect(detectForms(d)).toHaveLength(0);
  });

  it('falls back to nearest preceding text input when no name/email hints', () => {
    const d = doc(`
      <form>
        <input type="text" id="handle" />
        <input type="password" id="pw" />
      </form>`);
    const forms = detectForms(d);
    expect(forms[0].usernameSelector).toBe('#handle');
  });

  it('handles password-only forms (username unknown)', () => {
    const d = doc(`<form><input type="password" id="pw" /></form>`);
    const forms = detectForms(d);
    expect(forms[0].usernameSelector).toBeNull();
    expect(forms[0].passwordSelector).toBe('#pw');
  });
});
