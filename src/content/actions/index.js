/**
 * Action registry — maps action names to handler functions.
 * Each handler receives (step, engine, Overlay).
 */

import * as core from './core.js';
import * as dom from './dom.js';
import * as ai from './ai.js';

export const ACTION_REGISTRY = {
  // Core
  setVar: core.setVar,
  incrementVar: core.incrementVar,
  appendArray: core.appendArray,
  updateProgress: core.updateProgress,
  log: core.log,

  // DOM
  find: dom.find,
  findAll: dom.findAll,
  click: dom.click,
  wait: dom.wait,
  scroll: dom.scroll,
  scrollIntoView: dom.scrollIntoView,
  countElements: dom.countElements,
  checkSecurity: dom.checkSecurity,
  dismissModal: dom.dismissModal,
  handleInviteModal: dom.handleInviteModal,
  dismissDropdown: dom.dismissDropdown,
  navigateNext: dom.navigateNext,
  waitForNew: dom.waitForNew,
  waitForElement: dom.waitForElement,
  verifyDropdown: dom.verifyDropdown,

  // AI & Data
  extract: ai.extract,
  extractAll: ai.extractAll,
  aiCall: ai.aiCall,
  storeData: ai.storeData,
  navigate: ai.navigate,
  getPageContent: ai.getPageContent,
  prompt: ai.prompt,
  typeText: ai.typeText
};
