/**
 * ButtonInjector — dynamically injects action buttons based on active playbooks.
 * Replaces the hardcoded addButtons() and addSearchButton() from content.js.
 */

import { EXTENSION_UI_CLASSES } from '../shared/constants.js';

/**
 * Inject buttons for matching playbooks on the current page.
 * @param {Object} playbooks - All loaded playbooks
 * @param {Object} settings - User settings (for maxInvites display)
 * @param {Function} onRunPlaybook - Callback: (playbookId) => void
 */
export function injectButtons(playbooks, settings, onRunPlaybook) {
  const url = window.location.href;

  // Group matching playbooks by selector registry for invitation-style grouping
  const invitationPlaybooks = [];

  for (const [id, playbook] of Object.entries(playbooks)) {
    let pattern;
    try {
      pattern = new RegExp(playbook.urlPattern);
    } catch {
      console.warn(`ButtonInjector: invalid urlPattern for "${id}":`, playbook.urlPattern);
      continue;
    }
    if (!pattern.test(url)) continue;
    if (document.querySelector(`[data-playbook-id="${id}"]`)) continue;

    if (playbook.selectors === 'linkedin.invitations') {
      invitationPlaybooks.push(playbook);
    } else if (playbook.buttonLabel) {
      // Generic single-button injection for any playbook with a buttonLabel
      injectGenericButton(playbook, settings, onRunPlaybook);
    }
  }

  // Invitation playbooks get grouped into a single container
  if (invitationPlaybooks.length > 0) {
    injectInvitationButtons(invitationPlaybooks, onRunPlaybook);
  }
}

/**
 * Remove all injected buttons and the stack container if empty.
 */
export function removeAllButtons() {
  const containers = document.querySelectorAll('[data-playbook-injected]');
  containers.forEach(el => el.remove());
  const stack = document.getElementById('li-bulk-button-stack');
  if (stack && stack.children.length === 0) stack.remove();
}

/**
 * Inject grouped buttons for invitation manager playbooks.
 * @param {Object[]} playbooks - Array of invitation playbooks
 * @param {Function} onRunPlaybook
 */
function injectInvitationButtons(playbooks, onRunPlaybook) {
  if (document.querySelector(`.${EXTENSION_UI_CLASSES.ACTION_BUTTONS}`)) return;

  const container = document.createElement('div');
  container.className = EXTENSION_UI_CLASSES.ACTION_BUTTONS;
  container.setAttribute('data-playbook-injected', 'true');
  container.setAttribute('data-playbook-id', playbooks[0].id);
  Object.assign(container.style, {
    position: 'fixed',
    top: '80px',
    left: '20px',
    display: 'flex',
    gap: '12px',
    zIndex: '9999',
    padding: '12px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
    border: '1px solid #e0e0e0'
  });

  for (const playbook of playbooks) {
    const label = playbook.buttonLabel || playbook.name;
    const btn = createStyledButton(label);
    btn.setAttribute('data-playbook-id', playbook.id);
    btn.addEventListener('click', () => onRunPlaybook(playbook.id));
    container.appendChild(btn);
  }

  document.body.appendChild(container);
}

/**
 * Get or create the shared stacking container for generic buttons.
 * @returns {HTMLDivElement}
 */
function getOrCreateStack() {
  let stack = document.getElementById('li-bulk-button-stack');
  if (stack) return stack;
  stack = document.createElement('div');
  stack.id = 'li-bulk-button-stack';
  Object.assign(stack.style, {
    position: 'fixed',
    top: '80px',
    right: '20px',
    zIndex: '1000',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  });
  document.body.appendChild(stack);
  return stack;
}

/**
 * Inject a single button for any playbook that has a buttonLabel.
 * Generic — works for search, profile, messaging, connections, or any future page.
 * @param {Object} playbook
 * @param {Object} settings
 * @param {Function} onRunPlaybook
 */
function injectGenericButton(playbook, settings, onRunPlaybook) {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-playbook-injected', 'true');
  wrapper.setAttribute('data-playbook-id', playbook.id);
  Object.assign(wrapper.style, {
    padding: '8px',
    backgroundColor: 'white',
    boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
    borderRadius: '8px',
    border: '1px solid #e0e0e0'
  });

  // Build label — substitute maxInvites if the label contains a placeholder
  let label = playbook.buttonLabel;
  if (label && label.includes('\u2264')) {
    const max = settings.maxInvites ?? playbook.settings?.maxItems ?? 50;
    label = label.replace(/\u2264\s*\d*/, `\u2264 ${max}`);
  }

  const btn = createStyledButton(label || playbook.name);
  btn.style.whiteSpace = 'nowrap';
  btn.addEventListener('click', () => onRunPlaybook(playbook.id));

  wrapper.appendChild(btn);
  getOrCreateStack().appendChild(wrapper);
}

/**
 * Create a LinkedIn-styled button.
 * @param {string} text
 * @returns {HTMLButtonElement}
 */
function createStyledButton(text) {
  const btn = document.createElement('button');
  btn.textContent = text;
  Object.assign(btn.style, {
    backgroundColor: '#0a66c2',
    color: 'white',
    border: 'none',
    borderRadius: '24px',
    padding: '8px 16px',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  });

  btn.addEventListener('mouseover', () => { btn.style.backgroundColor = '#084d93'; });
  btn.addEventListener('mouseout', () => { btn.style.backgroundColor = '#0a66c2'; });

  return btn;
}
