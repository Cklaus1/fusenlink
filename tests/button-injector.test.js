/**
 * Smoke tests for src/ui/button-injector.js.
 * Exercises the public API (injectButtons / removeAllButtons) under jsdom.
 */

import { injectButtons, removeAllButtons } from '../src/ui/button-injector.js';

function setLocation(href, pathname) {
  // jsdom's window.location is read-only; replace it via defineProperty
  Object.defineProperty(window, 'location', {
    value: { href, pathname },
    writable: true,
    configurable: true
  });
}

describe('button-injector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('injects invitation-style grouped container on invitation manager URL', () => {
    setLocation(
      'https://www.linkedin.com/mynetwork/invitation-manager/received/',
      '/mynetwork/invitation-manager/received/'
    );

    const playbooks = {
      'accept-invites': {
        id: 'accept-invites',
        urlPattern: 'linkedin\\.com/mynetwork/invitation-manager/',
        selectors: 'linkedin.invitations',
        buttonLabel: 'Accept All',
        steps: [],
        version: 2
      }
    };

    const onRun = jest.fn();
    injectButtons(playbooks, { maxInvites: 50 }, onRun);

    const container = document.querySelector('.li-bulk-action-buttons');
    expect(container).not.toBeNull();
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Accept All');

    // Clicking the button forwards to the callback
    btn.click();
    expect(onRun).toHaveBeenCalledWith('accept-invites');
  });

  test('injects generic button into stack for non-invitation playbooks', () => {
    setLocation(
      'https://www.linkedin.com/search/results/people/',
      '/search/results/people/'
    );

    const playbooks = {
      'bulk-connect': {
        id: 'bulk-connect',
        urlPattern: 'linkedin\\.com/search/results/people/',
        selectors: 'linkedin.search',
        buttonLabel: 'Connect with ≤ 50',
        steps: [],
        version: 1
      }
    };

    injectButtons(playbooks, { maxInvites: 25 }, () => {});

    const stack = document.getElementById('li-bulk-button-stack');
    expect(stack).not.toBeNull();
    const wrapper = stack.querySelector('[data-playbook-id="bulk-connect"]');
    expect(wrapper).not.toBeNull();
    // Label should reflect maxInvites substitution (25 from settings)
    expect(wrapper.textContent).toContain('25');
  });

  test('removeAllButtons clears injected DOM and disposes stack', () => {
    setLocation(
      'https://www.linkedin.com/mynetwork/invitation-manager/received/',
      '/mynetwork/invitation-manager/received/'
    );

    const playbooks = {
      'accept-invites': {
        id: 'accept-invites',
        urlPattern: 'linkedin\\.com/mynetwork/invitation-manager/',
        selectors: 'linkedin.invitations',
        buttonLabel: 'Accept All',
        steps: [],
        version: 2
      }
    };

    injectButtons(playbooks, { maxInvites: 50 }, () => {});
    expect(document.querySelectorAll('[data-playbook-injected]').length).toBeGreaterThan(0);

    removeAllButtons();
    expect(document.querySelectorAll('[data-playbook-injected]').length).toBe(0);
  });

  test('feed page positions stack on the left (Bug 32 regression guard)', () => {
    setLocation('https://www.linkedin.com/feed/', '/feed/');

    const onFeedPlaybook = {
      'test-feed': {
        id: 'test-feed',
        urlPattern: 'linkedin\\.com/feed/',
        selectors: 'linkedin.feed',
        buttonLabel: 'Test Feed Button',
        steps: [],
        version: 1
      }
    };

    injectButtons(onFeedPlaybook, {}, () => {});

    const stack = document.getElementById('li-bulk-button-stack');
    expect(stack).not.toBeNull();
    expect(stack.style.left).toBe('20px');
    // Right should not be set (only one of left/right is applied per Bug 32)
    expect(stack.style.right).toBe('');
  });

  test('non-feed page also positions stack on the left (consistent across pages)', () => {
    setLocation(
      'https://www.linkedin.com/search/results/people/',
      '/search/results/people/'
    );

    const playbooks = {
      'bulk-connect': {
        id: 'bulk-connect',
        urlPattern: 'linkedin\\.com/search/results/people/',
        selectors: 'linkedin.search',
        buttonLabel: 'Connect',
        steps: [],
        version: 1
      }
    };

    injectButtons(playbooks, {}, () => {});

    const stack = document.getElementById('li-bulk-button-stack');
    expect(stack).not.toBeNull();
    // Always top-left now (was per-page left/right). Consistent across pages
    // and avoids overlap with LinkedIn's right-side widgets.
    expect(stack.style.left).toBe('20px');
    expect(stack.style.right).toBe('');
  });

  test('skips playbooks whose urlPattern does not match', () => {
    setLocation('https://www.linkedin.com/feed/', '/feed/');

    const playbooks = {
      'bulk-connect': {
        id: 'bulk-connect',
        urlPattern: 'linkedin\\.com/search/results/people/',
        selectors: 'linkedin.search',
        buttonLabel: 'Connect',
        steps: [],
        version: 1
      }
    };

    injectButtons(playbooks, {}, () => {});
    expect(document.querySelectorAll('[data-playbook-injected]').length).toBe(0);
  });

  test('tolerates an invalid urlPattern without throwing', () => {
    setLocation('https://www.linkedin.com/feed/', '/feed/');

    const playbooks = {
      'broken': {
        id: 'broken',
        urlPattern: '(unclosed',
        selectors: 'linkedin.feed',
        buttonLabel: 'Broken',
        steps: [],
        version: 1
      }
    };

    expect(() => injectButtons(playbooks, {}, () => {})).not.toThrow();
    expect(document.querySelectorAll('[data-playbook-injected]').length).toBe(0);
  });

  test('does not inject duplicates when called twice for the same playbook', () => {
    setLocation(
      'https://www.linkedin.com/mynetwork/invitation-manager/received/',
      '/mynetwork/invitation-manager/received/'
    );

    const playbooks = {
      'accept-invites': {
        id: 'accept-invites',
        urlPattern: 'linkedin\\.com/mynetwork/invitation-manager/',
        selectors: 'linkedin.invitations',
        buttonLabel: 'Accept All',
        steps: [],
        version: 2
      }
    };

    injectButtons(playbooks, { maxInvites: 50 }, () => {});
    injectButtons(playbooks, { maxInvites: 50 }, () => {});

    // Only one container with data-playbook-injected should exist after a duplicate inject
    expect(document.querySelectorAll('[data-playbook-injected]').length).toBe(1);
    // And only one action-buttons container (the invitation-style group)
    expect(document.querySelectorAll('.li-bulk-action-buttons').length).toBe(1);
  });
});
