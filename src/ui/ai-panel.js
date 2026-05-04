/**
 * AIPanel — rich overlay for AI results, approval dialogs, and multi-option prompts.
 * Used by the 'prompt' engine action for trust-level review workflows.
 */

let panelElement = null;
let pendingResolve = null; // Track pending promise to prevent orphan on double-call

/**
 * Show a prompt dialog and wait for user selection.
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {string} options.body - Content body (supports multi-line)
 * @param {string[]} options.options - Array of button labels
 * @returns {Promise<string>} The selected option label
 */
export function showPrompt({ title, body, options }) {
  return new Promise((resolve) => {
    // If a previous prompt is pending, resolve it with null so it doesn't orphan
    if (pendingResolve) {
      pendingResolve(null);
      pendingResolve = null;
    }
    removePanel();
    pendingResolve = resolve;

    panelElement = document.createElement('div');
    panelElement.id = 'li-bulk-ai-panel';
    Object.assign(panelElement.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: 'white',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
      padding: '24px',
      zIndex: '10000',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: '500px',
      width: '90%',
      maxHeight: '80vh',
      overflow: 'auto',
      border: '1px solid #e0e0e0'
    });

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'li-bulk-ai-backdrop';
    Object.assign(backdrop.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: '9999'
    });

    // Title
    const titleEl = document.createElement('h3');
    titleEl.textContent = title || 'AI Result';
    Object.assign(titleEl.style, {
      margin: '0 0 12px 0',
      color: '#0a66c2',
      fontSize: '18px',
      fontWeight: 'bold'
    });

    // Body
    const bodyEl = document.createElement('div');
    bodyEl.style.whiteSpace = 'pre-wrap';
    bodyEl.style.marginBottom = '20px';
    bodyEl.style.fontSize = '14px';
    bodyEl.style.lineHeight = '1.5';
    bodyEl.style.color = '#333';

    // Handle body that might be an object; truncate if excessively large
    const MAX_BODY_LENGTH = 10000;
    let displayBody;
    if (typeof body === 'object') {
      try { displayBody = JSON.stringify(body, null, 2); } catch { displayBody = '[Unable to serialize]'; }
    } else {
      displayBody = String(body || '');
    }
    if (displayBody.length > MAX_BODY_LENGTH) {
      displayBody = displayBody.slice(0, MAX_BODY_LENGTH) + '\n... (truncated)';
    }
    bodyEl.textContent = displayBody;

    // Buttons container
    const buttonsEl = document.createElement('div');
    Object.assign(buttonsEl.style, {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      justifyContent: 'flex-end'
    });

    for (const option of (options || ['OK'])) {
      const btn = document.createElement('button');
      btn.textContent = option;
      Object.assign(btn.style, {
        padding: '8px 16px',
        borderRadius: '20px',
        border: '1px solid #0a66c2',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '600',
        backgroundColor: option === options[0] ? '#0a66c2' : 'white',
        color: option === options[0] ? 'white' : '#0a66c2',
        transition: 'background-color 0.2s'
      });

      btn.addEventListener('click', () => {
        pendingResolve = null;
        removePanel();
        backdrop.remove();
        resolve(option);
      });

      buttonsEl.appendChild(btn);
    }

    panelElement.appendChild(titleEl);
    panelElement.appendChild(bodyEl);
    panelElement.appendChild(buttonsEl);

    document.body.appendChild(backdrop);
    document.body.appendChild(panelElement);
  });
}

/**
 * Show an AI result display (non-blocking, with dismiss).
 * @param {Object} options
 * @param {string} options.title
 * @param {string|Object} options.content
 */
export function showResult({ title, content }) {
  return showPrompt({
    title,
    body: content,
    options: ['Done']
  });
}

/**
 * Remove the AI panel if visible.
 */
export function removePanel() {
  const el = panelElement;
  panelElement = null; // Null out first so re-entrant calls are safe
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
  const backdrop = document.getElementById('li-bulk-ai-backdrop');
  if (backdrop) backdrop.remove();
}
