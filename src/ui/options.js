/**
 * Options Page Script — settings UI.
 * Uses shared constants for defaults (fixes bug #9: single source of truth).
 */

import { DEFAULT_SETTINGS } from '../shared/constants.js';

// DOM Elements
const form = document.getElementById('settingsForm');
const maxInvitesInput = document.getElementById('maxInvites');
const delayMsInput = document.getElementById('delayMs');
const toast = document.getElementById('toast');

// Load current settings
document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (settings) => {
    if (chrome.runtime.lastError) {
      maxInvitesInput.value = DEFAULT_SETTINGS.maxInvites;
      delayMsInput.value = DEFAULT_SETTINGS.delayMs;
      return;
    }
    maxInvitesInput.value = (settings && settings.maxInvites) || DEFAULT_SETTINGS.maxInvites;
    delayMsInput.value = (settings && settings.delayMs) || DEFAULT_SETTINGS.delayMs;
  });
});

// Save settings
form.addEventListener('submit', (e) => {
  e.preventDefault();

  const maxInvites = parseInt(maxInvitesInput.value, 10);
  const delayMs = parseInt(delayMsInput.value, 10);

  if (isNaN(maxInvites) || maxInvites < 1) {
    maxInvitesInput.value = DEFAULT_SETTINGS.maxInvites;
    return;
  }

  if (isNaN(delayMs) || delayMs < 500) {
    delayMsInput.value = DEFAULT_SETTINGS.delayMs;
    return;
  }

  chrome.runtime.sendMessage({
    action: 'setSettings',
    settings: { maxInvites, delayMs }
  }, () => {
    if (chrome.runtime.lastError) return;
    showToast();
  });
});

function showToast() {
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// --- Daily Limits ---
const limitsForm = document.getElementById('limitsForm');
const limitAccept = document.getElementById('limitAccept');
const limitConnect = document.getElementById('limitConnect');
const limitExtract = document.getElementById('limitExtract');

if (limitsForm) {
  // Load current limits via message router for consistency
  document.addEventListener('DOMContentLoaded', () => {
    chrome.runtime.sendMessage({ action: 'getDailyLimits' }, (limits) => {
      if (chrome.runtime.lastError || !limits) return;
      if (limits['accept-invites'] && limitAccept) limitAccept.value = limits['accept-invites'];
      if (limits['bulk-connect'] && limitConnect) limitConnect.value = limits['bulk-connect'];
      if (limits['extract-contacts'] && limitExtract) limitExtract.value = limits['extract-contacts'];
    });
  });

  limitsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const limits = {
      'accept-invites': parseInt(limitAccept.value) || 5,
      'deny-invites': parseInt(limitAccept.value) || 5,
      'bulk-connect': parseInt(limitConnect.value) || 3,
      'extract-contacts': parseInt(limitExtract.value) || 10,
      'inbox-analysis': parseInt(limitExtract.value) || 10,
      'ai-profile-review': parseInt(limitExtract.value) || 10
    };
    chrome.runtime.sendMessage({ action: 'setDailyLimits', limits }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to set daily limits:', chrome.runtime.lastError.message);
        return;
      }
      if (response?.success) showToast();
    });
  });
}

// --- AI Config (guarded — elements may not exist if options.html is outdated) ---
const aiForm = document.getElementById('aiForm');
const aiProvider = document.getElementById('aiProvider');
const aiBaseUrl = document.getElementById('aiBaseUrl');
const aiApiKey = document.getElementById('aiApiKey');
const aiModel = document.getElementById('aiModel');

// Provider → default base URL mapping
const providerDefaults = {
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1:8b' },
  vllm: { baseUrl: 'http://localhost:8000/v1', model: 'google/gemma-3-27b-it' },
  sglang: { baseUrl: 'http://localhost:30000/v1', model: 'default' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4' },
  'nvidia-nim': { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' }
};

// Auto-fill defaults when provider changes (guarded for missing elements)
if (aiProvider && aiBaseUrl && aiModel) {
  aiProvider.addEventListener('change', () => {
    const defaults = providerDefaults[aiProvider.value];
    if (defaults) {
      aiBaseUrl.value = defaults.baseUrl;
      aiModel.value = defaults.model;
    }
  });
}

// Load AI config
document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ action: 'aiStatus' }, (status) => {
    if (chrome.runtime.lastError || !status) return;
    if (status.provider && aiProvider) aiProvider.value = status.provider;
  });

  chrome.storage.local.get('ai', (result) => {
    const config = result.ai || {};
    if (config.provider && aiProvider) aiProvider.value = config.provider;
    if (config.baseUrl && aiBaseUrl) aiBaseUrl.value = config.baseUrl;
    if (config.apiKey && aiApiKey) aiApiKey.value = config.apiKey;
    if (config.model && aiModel) aiModel.value = config.model;
  });
});

// Save AI config
if (aiForm) {
  aiForm.addEventListener('submit', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({
      action: 'aiConfigure',
      config: {
        provider: aiProvider.value,
        baseUrl: aiBaseUrl.value,
        apiKey: aiApiKey.value,
        model: aiModel.value
      }
    }, () => {
      if (!chrome.runtime.lastError) showToast();
    });
  });
}

// --- Cohort Config ---
const cohortForm = document.getElementById('cohortForm');
const cohortName = document.getElementById('cohortName');
const cohortMembers = document.getElementById('cohortMembers');

const cohortSyncUrl = document.getElementById('cohortSyncUrl');
const cohortMySlug = document.getElementById('cohortMySlug');

if (cohortForm) {
  document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get('cohort', (result) => {
      const cohort = result.cohort || {};
      if (cohort.name && cohortName) cohortName.value = cohort.name;
      if (cohort.syncUrl && cohortSyncUrl) cohortSyncUrl.value = cohort.syncUrl;
      if (cohort.mySlug && cohortMySlug) cohortMySlug.value = cohort.mySlug;
      if (cohort.members && cohortMembers) {
        const urls = Array.isArray(cohort.members)
          ? cohort.members.map(m => typeof m === 'string' ? m : m?.linkedin).filter(Boolean)
          : [];
        cohortMembers.value = urls.join('\n');
      }
    });
  });

  cohortForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const memberUrls = (cohortMembers.value || '')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.includes('linkedin.com/in/'));

    chrome.storage.local.get('cohort', (result) => {
      const existing = result.cohort || {};
      const updated = {
        ...existing,
        name: cohortName.value.trim(),
        syncUrl: cohortSyncUrl?.value?.trim() || '',
        mySlug: cohortMySlug?.value?.trim() || '',
        members: existing.members && existing.members[0]?.name
          ? existing.members // Preserve rich member data from sync
          : memberUrls.map(url => ({ linkedin: url })),
        updatedAt: new Date().toISOString()
      };
      chrome.storage.local.set({ cohort: updated }, () => showToast());
    });
  });
}

// Bug 6: surface storage usage in a "Storage" section.
// Reads the sentinel `meta.quota` key written by storage.js.
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get('meta.quota', (result) => {
    if (chrome.runtime.lastError) return;
    const q = result['meta.quota'];
    const el = document.getElementById('storageStats');
    if (!el) return;
    if (!q) {
      el.textContent = 'Storage usage: not yet measured.';
      return;
    }
    const usedMB = (q.bytes / 1024 / 1024).toFixed(2);
    const limitMB = (q.limit / 1024 / 1024).toFixed(0);
    const pct = Math.round(q.ratio * 100);
    const when = q.lastChecked ? new Date(q.lastChecked).toLocaleString() : 'unknown';
    el.textContent =
      `Storage usage: ${usedMB} MB / ${limitMB} MB (${pct}%) — last checked ${when}`;
  });
});

// Bug 7: surface the migration log in a "Recent Updates" section.
// Reads the `meta.migrations` array written by playbook-store.js.
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get('meta.migrations', (result) => {
    if (chrome.runtime.lastError) return;
    const log = Array.isArray(result['meta.migrations']) ? result['meta.migrations'] : [];
    const el = document.getElementById('migrationLog');
    if (!el) return;
    if (log.length === 0) {
      el.textContent = 'No migrations recorded.';
      return;
    }
    el.innerHTML = '';
    log.slice(-10).reverse().forEach((entry) => {
      const div = document.createElement('div');
      div.className = 'migration-entry';
      const when = entry.migratedAt ? new Date(entry.migratedAt).toLocaleString() : 'unknown';
      const playbooks = (entry.changes && entry.changes.playbooks) || [];
      const selectors = (entry.changes && entry.changes.selectors) || [];
      const parts = [];
      if (playbooks.length) parts.push(`playbooks: ${playbooks.join(', ')}`);
      if (selectors.length) parts.push(`selectors: ${selectors.join(', ')}`);
      const summary = parts.join(' | ') || 'no playbook changes';
      div.textContent = `${when} — ${summary}`;
      el.appendChild(div);
    });
  });
});

// Test Connection button
const testBtn = document.getElementById('testConnection');
const testResult = document.getElementById('testResult');

if (testBtn) {
  testBtn.addEventListener('click', () => {
    testResult.style.display = 'block';
    testResult.style.color = '#666';
    testResult.textContent = 'Testing connection...';

    // Save current config first, then test
    chrome.runtime.sendMessage({
      action: 'aiConfigure',
      config: {
        provider: aiProvider?.value,
        baseUrl: aiBaseUrl?.value,
        apiKey: aiApiKey?.value,
        model: aiModel?.value
      }
    }, () => {
      chrome.runtime.sendMessage({ action: 'aiStatus' }, (status) => {
        if (chrome.runtime.lastError) {
          testResult.style.color = '#d93025';
          testResult.textContent = 'Error: ' + chrome.runtime.lastError.message;
          return;
        }
        if (status?.reachable) {
          testResult.style.color = '#137333';
          testResult.textContent = `Connected! Provider: ${status.provider}, Model: ${status.model}`;
        } else {
          testResult.style.color = '#d93025';
          testResult.textContent = `Connection failed: ${status?.error || 'unreachable'}. Check the base URL and API key.`;
        }
      });
    });
  });
}
