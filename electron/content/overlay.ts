import type { Candidate } from './messages';

const OVERLAY_ID = '__secure_browser_autofill_overlay__';

/**
 * Render an overlay anchored near `anchor`, listing candidate usernames.
 * `onPick` fires with the chosen credential id on click.
 */
export function showOverlay(
  anchor: HTMLElement,
  candidates: Candidate[],
  onPick: (credentialId: string) => void,
): void {
  removeOverlay();
  if (candidates.length === 0) return;

  const rect = anchor.getBoundingClientRect();
  const box = document.createElement('div');
  box.id = OVERLAY_ID;
  box.setAttribute('data-testid', 'autofill-overlay');
  Object.assign(box.style, {
    position: 'absolute',
    left: `${rect.left + window.scrollX}px`,
    top: `${rect.bottom + window.scrollY}px`,
    zIndex: '2147483647',
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: '6px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    font: '13px system-ui, sans-serif',
    minWidth: '220px',
  });

  for (const c of candidates) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('data-testid', 'autofill-candidate');
    item.textContent = c.label ? `${c.username} — ${c.label}` : c.username;
    Object.assign(item.style, {
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '8px 12px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
    });
    item.addEventListener('mouseenter', () => (item.style.background = '#f1f3f4'));
    item.addEventListener('mouseleave', () => (item.style.background = 'transparent'));
    // The user gesture that authorizes plaintext release.
    item.addEventListener('click', () => {
      removeOverlay();
      onPick(c.id);
    });
    box.appendChild(item);
  }

  document.body.appendChild(box);
}

export function removeOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}
