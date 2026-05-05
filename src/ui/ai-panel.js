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
 * @param {string|Object} options.body - Content body. Plain string/object renders as
 *   pre-formatted text. An object with `__type: 'inbox-analysis-result'` renders
 *   a structured result with per-item action buttons (Star / Move / Draft Reply).
 * @param {string[]} options.options - Array of button labels
 * @returns {Promise<string>} The selected option label
 */
export function showPrompt({ title, body, options }) {
  return new Promise((resolve) => {
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
      maxWidth: '640px',
      width: '92%',
      maxHeight: '82vh',
      overflow: 'auto',
      border: '1px solid #e0e0e0'
    });

    const backdrop = document.createElement('div');
    backdrop.id = 'li-bulk-ai-backdrop';
    Object.assign(backdrop.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0', bottom: '0',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: '9999'
    });

    const titleEl = document.createElement('h3');
    titleEl.textContent = title || 'AI Result';
    Object.assign(titleEl.style, {
      margin: '0 0 12px 0',
      color: '#0a66c2',
      fontSize: '18px',
      fontWeight: 'bold'
    });
    panelElement.appendChild(titleEl);

    // Rich rendering for known structured result shapes; fall back to text.
    if (body && typeof body === 'object' && body.__type === 'inbox-analysis-result') {
      panelElement.appendChild(renderInboxResult(body));
    } else if (body && typeof body === 'object' && body.__type === 'draft-reply-result') {
      panelElement.appendChild(renderDraftReply(body));
    } else {
      panelElement.appendChild(renderTextBody(body));
    }

    const buttonsEl = document.createElement('div');
    Object.assign(buttonsEl.style, {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      marginTop: '16px'
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

    panelElement.appendChild(buttonsEl);
    document.body.appendChild(backdrop);
    document.body.appendChild(panelElement);
  });
}

function renderTextBody(body) {
  const bodyEl = document.createElement('div');
  Object.assign(bodyEl.style, {
    whiteSpace: 'pre-wrap',
    fontSize: '14px',
    lineHeight: '1.5',
    color: '#333'
  });
  const MAX_BODY_LENGTH = 10000;
  let display;
  if (typeof body === 'object') {
    try { display = JSON.stringify(body, null, 2); } catch { display = '[Unable to serialize]'; }
  } else {
    display = String(body || '');
  }
  if (display.length > MAX_BODY_LENGTH) display = display.slice(0, MAX_BODY_LENGTH) + '\n... (truncated)';
  bodyEl.textContent = display;
  return bodyEl;
}

/**
 * Render the inbox-analysis result with per-item action buttons.
 * The body shape is { __type, classification: {digest, highPriority, lowPriority, spam}, conversations }.
 * Each highPriority/lowPriority/spam item is matched to a conversation by name to recover threadUrl,
 * then rendered as a row with action buttons that navigate to the thread with a query param the
 * thread-page bundle uses to auto-fire the corresponding playbook.
 */
function renderInboxResult(body) {
  const { classification = {}, conversations = [] } = body;
  const wrap = document.createElement('div');
  wrap.style.fontSize = '14px';
  wrap.style.color = '#333';

  // name -> conversation lookup, case-insensitive trim
  const byName = {};
  for (const c of conversations) {
    if (c && c.name) byName[String(c.name).trim().toLowerCase()] = c;
  }
  const lookup = (name) => byName[String(name || '').trim().toLowerCase()] || null;

  if (classification.digest) {
    const digest = document.createElement('p');
    digest.textContent = classification.digest;
    Object.assign(digest.style, {
      margin: '0 0 16px 0',
      padding: '10px 12px',
      background: '#f3f6f8',
      borderLeft: '3px solid #0a66c2',
      borderRadius: '4px',
      lineHeight: '1.5'
    });
    wrap.appendChild(digest);
  }

  const sections = [
    { key: 'highPriority', label: 'High Priority', actions: ['star', 'reply'] },
    { key: 'lowPriority', label: 'Low Priority', actions: ['reply'] },
    { key: 'spam', label: 'Spam', actions: ['move'] }
  ];

  for (const sec of sections) {
    const items = classification[sec.key] || [];
    if (!Array.isArray(items) || items.length === 0) continue;

    const h = document.createElement('h4');
    h.textContent = `${sec.label} (${items.length})`;
    Object.assign(h.style, {
      margin: '14px 0 6px 0',
      fontSize: '13px',
      color: '#666',
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    });
    wrap.appendChild(h);

    for (const item of items) {
      wrap.appendChild(renderItemRow(item, lookup(item.name), sec.actions));
    }
  }

  return wrap;
}

function renderItemRow(item, conv, actions) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '10px 0',
    borderBottom: '1px solid #eee'
  });

  const text = document.createElement('div');
  text.style.flex = '1';
  text.style.minWidth = '0';

  const name = document.createElement('div');
  name.textContent = item.name || '(no name)';
  name.style.fontWeight = '600';
  name.style.marginBottom = '2px';
  text.appendChild(name);

  const reason = item.reason || item.suggestedAction || '';
  if (reason) {
    const r = document.createElement('div');
    r.textContent = reason;
    Object.assign(r.style, {
      fontSize: '13px',
      color: '#555',
      lineHeight: '1.4'
    });
    text.appendChild(r);
  }
  row.appendChild(text);

  const btns = document.createElement('div');
  Object.assign(btns.style, { display: 'flex', gap: '6px', flexShrink: '0' });

  const url = conv && conv.threadUrl ? conv.threadUrl : null;
  const mkBtn = (label, playbookId, title) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title || label;
    Object.assign(b.style, {
      padding: '4px 10px',
      borderRadius: '14px',
      border: '1px solid #d0d0d0',
      cursor: url ? 'pointer' : 'not-allowed',
      fontSize: '12px',
      background: 'white',
      color: '#333',
      whiteSpace: 'nowrap',
      opacity: url ? '1' : '0.4'
    });
    b.disabled = !url;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!url) return;
      navigateAndRun(url, playbookId);
    });
    return b;
  };

  const actionMap = {
    star: () => mkBtn('⭐ Star', 'star-thread', 'Open thread + toggle star'),
    reply: () => mkBtn('📝 Draft Reply', 'draft-reply', 'Open thread + AI-draft a reply'),
    move: () => mkBtn('📦 Move to Other', 'mark-as-other', 'Open thread + move to Other inbox')
  };
  for (const act of actions) {
    const make = actionMap[act];
    if (make) btns.appendChild(make());
  }
  row.appendChild(btns);
  return row;
}

/**
 * Render the draft-reply result with two (or however many) labeled draft
 * blocks. Each draft shows a tone badge and the body text. The user picks
 * Send #1 / Send #2 from the bottom button row.
 */
function renderDraftReply(body) {
  const drafts = (body && body.drafts && Array.isArray(body.drafts.options))
    ? body.drafts.options
    : [];
  const wrap = document.createElement('div');
  wrap.style.fontSize = '14px';
  wrap.style.color = '#333';

  if (drafts.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No drafts returned. Cancel and try again.';
    empty.style.color = '#a00';
    wrap.appendChild(empty);
    return wrap;
  }

  drafts.forEach((d, i) => {
    const card = document.createElement('div');
    Object.assign(card.style, {
      padding: '12px 14px',
      marginBottom: '10px',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      background: '#fafbfc'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '8px'
    });
    const num = document.createElement('strong');
    num.textContent = `#${i + 1}`;
    num.style.color = '#0a66c2';
    header.appendChild(num);

    if (d.tone) {
      const badge = document.createElement('span');
      badge.textContent = d.tone;
      Object.assign(badge.style, {
        padding: '2px 8px',
        borderRadius: '10px',
        background: '#0a66c2',
        color: 'white',
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      });
      header.appendChild(badge);
    }
    card.appendChild(header);

    const text = document.createElement('div');
    text.textContent = d.text || '(empty draft)';
    Object.assign(text.style, {
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap'
    });
    card.appendChild(text);
    wrap.appendChild(card);
  });

  return wrap;
}

/**
 * Navigate to a thread URL with a query param that the thread-page bundle
 * picks up on init to auto-fire the named playbook. Param is named
 * `__fl-run` (double underscore) to avoid colliding with any LinkedIn-side
 * params; the thread-page bundle parses it, dispatches RUN_PLAYBOOK, and
 * scrubs the param from the URL so a manual reload doesn't re-fire.
 */
function navigateAndRun(url, playbookId) {
  try {
    const u = new URL(url, location.origin);
    u.searchParams.set('__fl-run', playbookId);
    window.location.href = u.toString();
  } catch {
    // URL parsing failed (relative href edge case) — fall back to plain nav
    const sep = url.includes('?') ? '&' : '?';
    window.location.href = `${url}${sep}__fl-run=${encodeURIComponent(playbookId)}`;
  }
}

/**
 * Show an AI result display (non-blocking, with dismiss).
 */
export function showResult({ title, content }) {
  return showPrompt({ title, body: content, options: ['Done'] });
}

export function removePanel() {
  const el = panelElement;
  panelElement = null;
  if (el && el.parentNode) el.parentNode.removeChild(el);
  const backdrop = document.getElementById('li-bulk-ai-backdrop');
  if (backdrop) backdrop.remove();
}
