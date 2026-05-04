/**
 * Tests for DOM Operations
 */
import { delay, click, scroll, waitForNew, waitForElement, dismissModal, handleInviteModal, navigateNext, dismissDropdown } from '../src/content/dom-ops.js';
import { SelectorResolver } from '../src/content/selector-resolver.js';

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = jest.fn();

describe('DOM Operations', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('delay', () => {
    test('resolves after specified time', async () => {
      const start = Date.now();
      await delay(50);
      expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    });
  });

  describe('click', () => {
    test('calls click on element attached to DOM', () => {
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      const spy = jest.spyOn(btn, 'click');
      click(btn);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('skips detached element', () => {
      const btn = document.createElement('button');
      // Not attached to DOM
      const spy = jest.spyOn(btn, 'click');
      click(btn);
      expect(spy).not.toHaveBeenCalled();
    });

    test('handles null element gracefully', () => {
      expect(() => click(null)).not.toThrow();
    });
  });

  describe('scroll', () => {
    test('scrolls to top', () => {
      scroll('top');
      expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    });

    test('scrolls to bottom', () => {
      scroll('bottom');
      expect(window.scrollTo).toHaveBeenCalledWith(0, document.body.scrollHeight);
    });
  });

  describe('dismissDropdown', () => {
    test('clicks document body', () => {
      const spy = jest.spyOn(document.body, 'click');
      dismissDropdown();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('waitForNew', () => {
    test('returns true when new elements appear', async () => {
      document.body.innerHTML = '<div class="item">1</div>';
      const resolver = new SelectorResolver({
        items: { strategies: [{ type: 'css', value: '.item' }] }
      });

      // Add element after a short delay
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'item';
        document.body.appendChild(el);
      }, 50);

      const result = await waitForNew(resolver, 'items', { maxAttempts: 3, intervalMs: 50 });
      expect(result).toBe(true);
    });

    test('returns false after max attempts', async () => {
      document.body.innerHTML = '<div class="item">1</div>';
      const resolver = new SelectorResolver({
        items: { strategies: [{ type: 'css', value: '.item' }] }
      });

      const result = await waitForNew(resolver, 'items', { maxAttempts: 2, intervalMs: 10 });
      expect(result).toBe(false);
    });
  });

  describe('waitForElement', () => {
    test('returns true when element appears', async () => {
      const resolver = new SelectorResolver({
        target: { strategies: [{ type: 'css', value: '.target' }] }
      });

      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'target';
        document.body.appendChild(el);
      }, 50);

      const result = await waitForElement(resolver, 'target', { maxAttempts: 3, intervalMs: 50 });
      expect(result).toBe(true);
    });

    test('returns false after max attempts', async () => {
      const resolver = new SelectorResolver({
        target: { strategies: [{ type: 'css', value: '.target' }] }
      });

      const result = await waitForElement(resolver, 'target', { maxAttempts: 2, intervalMs: 10 });
      expect(result).toBe(false);
    });
  });

  describe('dismissModal', () => {
    test('clicks dismiss button in modal scope', async () => {
      document.body.innerHTML = `
        <button aria-label="Dismiss">Page dismiss</button>
        <div role="dialog">
          <button aria-label="Dismiss">Modal dismiss</button>
        </div>
      `;
      const resolver = new SelectorResolver({
        dismissButton: {
          strategies: [{ type: 'css', value: 'button[aria-label="Dismiss"]' }],
          scope: 'modal'
        }
      });

      const modalBtn = document.querySelector('[role="dialog"] button');
      const spy = jest.spyOn(modalBtn, 'click');

      await dismissModal(resolver);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('handleInviteModal', () => {
    test('clicks send button in modal', async () => {
      document.body.innerHTML = `
        <div role="dialog">
          <button>Send without a note</button>
        </div>
      `;
      const resolver = new SelectorResolver({
        sendButton: {
          strategies: [{ type: 'textExact', value: 'button', text: 'Send without a note' }],
          scope: 'modal',
          filters: ['visible']
        },
        connectInModal: {
          strategies: [{ type: 'textExact', value: 'button', text: 'Connect' }],
          scope: 'modal'
        },
        dismissButton: {
          strategies: [{ type: 'css', value: 'button[aria-label="Dismiss"]' }],
          scope: 'modal'
        }
      });

      const sendBtn = document.querySelector('[role="dialog"] button');
      const spy = jest.spyOn(sendBtn, 'click');

      const result = await handleInviteModal(resolver);
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalled();
    });

    test('returns false and dismisses when no send button', async () => {
      document.body.innerHTML = `
        <div role="dialog">
          <button aria-label="Dismiss">X</button>
        </div>
      `;
      const resolver = new SelectorResolver({
        sendButton: {
          strategies: [{ type: 'textExact', value: 'button', text: 'Send' }],
          scope: 'modal',
          filters: ['visible']
        },
        connectInModal: {
          strategies: [{ type: 'textExact', value: 'button', text: 'Connect' }],
          scope: 'modal'
        },
        dismissButton: {
          strategies: [{ type: 'css', value: 'button[aria-label="Dismiss"]' }],
          scope: 'modal'
        }
      });

      const result = await handleInviteModal(resolver);
      expect(result).toBe(false);
    });
  });

  describe('navigateNext', () => {
    test('clicks next button when found', async () => {
      document.body.innerHTML = `
        <button aria-label="Next">Next</button>
      `;
      const resolver = new SelectorResolver({
        nextPageButton: {
          strategies: [{ type: 'css', value: 'button[aria-label="Next"]' }],
          filters: ['visible', 'enabled']
        }
      });

      const btn = document.querySelector('button');
      const spy = jest.spyOn(btn, 'click');

      const result = await navigateNext(resolver);
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalled();
    });

    test('returns false when no next button exists', async () => {
      document.body.innerHTML = '<div>No pagination</div>';
      const resolver = new SelectorResolver({
        nextPageButton: {
          strategies: [{ type: 'css', value: 'button[aria-label="Next"]' }],
          filters: ['visible', 'enabled']
        }
      });

      const result = await navigateNext(resolver);
      expect(result).toBe(false);
    });
  });
});
