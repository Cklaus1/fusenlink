/**
 * Unit tests for overlay.js component
 */

import { 
  showOverlay, 
  updateProgress, 
  updateStatus, 
  showSummary, 
  hideOverlay, 
  onStop,
  isOverlayVisible
} from '../lib/overlay';

describe('Overlay Component', () => {
  beforeEach(() => {
    // Set up a clean DOM environment for each test
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  test('showOverlay should create and append overlay to the body', () => {
    showOverlay('Test Label');
    
    // Check overlay was created
    const overlay = document.getElementById('li-bulk-overlay');
    expect(overlay).not.toBeNull();
    
    // Check label was set correctly
    expect(overlay.textContent).toContain('Test Label');
    
    // Check overlay is visible
    expect(isOverlayVisible()).toBe(true);
  });

  test('updateProgress should update progress text', () => {
    showOverlay('Testing');
    updateProgress(5, 10, 2.5);
    
    const overlay = document.getElementById('li-bulk-overlay');
    expect(overlay.textContent).toContain('Processed: 5 / 10');
    expect(overlay.textContent).toContain('2.5s elapsed');
  });

  test('updateStatus should update status text', () => {
    showOverlay('Testing');
    updateStatus('Working...');
    
    const overlay = document.getElementById('li-bulk-overlay');
    expect(overlay.textContent).toContain('Working...');
  });

  test('showSummary should update with summary and disable stop button', () => {
    showOverlay('Testing');
    showSummary('All done!');
    
    const overlay = document.getElementById('li-bulk-overlay');
    expect(overlay.textContent).toContain('All done!');
    
    // Check stop button is disabled
    const stopButton = overlay.querySelector('button');
    expect(stopButton.disabled).toBe(true);
    expect(stopButton.textContent).toBe('Done');
  });

  test('hideOverlay should remove overlay from DOM', () => {
    showOverlay('Testing');
    hideOverlay();
    
    const overlay = document.getElementById('li-bulk-overlay');
    expect(overlay).toBeNull();
    expect(isOverlayVisible()).toBe(false);
  });

  test('onStop should register callback that fires when stop button is clicked', () => {
    showOverlay('Testing');
    
    const stopCallback = jest.fn();
    onStop(stopCallback);
    
    // Click the stop button
    const stopButton = document.querySelector('#li-bulk-overlay button');
    stopButton.click();
    
    expect(stopCallback).toHaveBeenCalled();
  });
});