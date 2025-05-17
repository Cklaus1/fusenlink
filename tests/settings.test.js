/**
 * Unit tests for settings.js utility
 */

import { getSettings, updateSettings } from '../lib/settings';

describe('Settings Utility', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  test('getSettings should retrieve settings from chrome storage', async () => {
    const settings = await getSettings();
    
    // Check chrome API was called correctly
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'getSettings' },
      expect.any(Function)
    );
    
    // Check settings are returned correctly
    expect(settings).toEqual({
      maxInvites: 50,
      delayMs: 1500
    });
  });

  test('updateSettings should save settings to chrome storage', async () => {
    const newSettings = {
      maxInvites: 25,
      delayMs: 2000
    };
    
    const result = await updateSettings(newSettings);
    
    // Check chrome API was called correctly
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { 
        action: 'setSettings',
        settings: newSettings
      },
      expect.any(Function)
    );
    
    // Check result is returned correctly
    expect(result).toEqual({ success: true });
  });
});