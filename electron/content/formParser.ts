import type { DetectedForm, FormKind } from './messages';

/**
 * Heuristics modeled (loosely) on Chromium's password form parser:
 * - A candidate form has >= 1 password field.
 * - Username = the visible text/email input immediately preceding the
 *   (first) password field; prefer type=email, then name/id hints.
 * - >= 2 password fields → signup; else login.
 */
export function detectForms(documentRef: Document): DetectedForm[] {
  const result: DetectedForm[] = [];
  const forms = Array.from(documentRef.querySelectorAll('form'));
  // Also consider a synthetic "form" of the whole document for formless logins.
  const scopes: Element[] = forms.length > 0 ? forms : [documentRef.body];

  scopes.forEach((scope, formIndex) => {
    const passwords = Array.from(
      scope.querySelectorAll('input[type="password"]'),
    ) as HTMLInputElement[];
    if (passwords.length === 0) return;

    const firstPw = passwords[0];
    const passwordSelector = selectorFor(firstPw);
    const kind: FormKind = passwords.length >= 2 ? 'signup' : 'login';

    const username = findUsernameField(scope, firstPw);
    result.push({
      formIndex,
      usernameSelector: username ? selectorFor(username) : null,
      passwordSelector,
      kind,
    });
  });

  return result;
}

function findUsernameField(scope: Element, pw: HTMLInputElement): HTMLInputElement | null {
  const inputs = Array.from(scope.querySelectorAll('input')) as HTMLInputElement[];
  const before = inputs.filter(
    (i) => i !== pw && i.type !== 'password' && isTextual(i) && precedes(i, pw),
  );
  if (before.length === 0) return null;

  // Prefer an email field.
  const email = before.find((i) => i.type === 'email');
  if (email) return email;

  // Prefer name/id hinting at a username.
  const hinted = before.find((i) => /user|email|login|account/i.test(`${i.name} ${i.id}`));
  if (hinted) return hinted;

  // Otherwise the nearest preceding textual input.
  return before[before.length - 1];
}

function isTextual(i: HTMLInputElement): boolean {
  const t = (i.getAttribute('type') ?? 'text').toLowerCase();
  return ['text', 'email', 'tel', ''].includes(t);
}

function precedes(a: Element, b: Element): boolean {
  // Node.DOCUMENT_POSITION_FOLLOWING === 4
  return !!(a.compareDocumentPosition(b) & 4);
}

/** Build a stable selector: prefer #id, else name=, else nth-of-type path. */
function selectorFor(el: HTMLInputElement): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  if (el.name) return `input[name="${cssEscape(el.name)}"]`;
  const parent = el.parentElement;
  if (!parent) return 'input';
  const idx = Array.from(parent.querySelectorAll('input')).indexOf(el);
  return `${tagPath(parent)} > input:nth-of-type(${idx + 1})`;
}

function tagPath(el: Element): string {
  return el.id ? `#${cssEscape(el.id)}` : el.tagName.toLowerCase();
}

function cssEscape(s: string): string {
  // Minimal escape sufficient for ids/names used in tests + common sites.
  return s.replace(/(["\\#.;,:>~+*\s])/g, '\\$1');
}
