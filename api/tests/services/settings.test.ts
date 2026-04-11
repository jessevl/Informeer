import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { setupTestDb, teardownTestDb } from '../helpers/db.ts';
import {
  getSetting,
  getAllSettings,
  getNestedSettings,
  updateSettings,
  invalidateSettingsCache,
  isModuleEnabled,
} from '../../src/services/settings.ts';

beforeEach(async () => {
  await setupTestDb();
});

afterAll(() => {
  teardownTestDb();
});

describe('getSetting', () => {
  test('returns a seeded setting', () => {
    const val = getSetting<number>('scheduler.interval_minutes');
    expect(val).toBe(60);
  });

  test('returns undefined for non-existent key', () => {
    expect(getSetting('nonexistent.key')).toBeUndefined();
  });

  test('returns boolean settings', () => {
    expect(getSetting<boolean>('modules.nrc.enabled')).toBe(false);
  });
});

describe('getAllSettings', () => {
  test('returns flat key-value map', () => {
    const all = getAllSettings();
    expect(all['scheduler.interval_minutes']).toBe(60);
    expect(all['modules.nrc.enabled']).toBe(false);
  });
});

describe('getNestedSettings', () => {
  test('nests dot-notation keys', () => {
    const nested = getNestedSettings();
    expect((nested as any).scheduler.interval_minutes).toBe(60);
    expect((nested as any).modules.nrc.enabled).toBe(false);
  });
});

describe('updateSettings', () => {
  test('updates an existing setting', () => {
    updateSettings({ 'scheduler.interval_minutes': 30 });
    expect(getSetting<number>('scheduler.interval_minutes')).toBe(30);
  });

  test('creates a new setting', () => {
    updateSettings({ 'custom.new_key': 'hello' });
    expect(getSetting<string>('custom.new_key')).toBe('hello');
  });

  test('invalidates cache after update', () => {
    expect(getSetting<number>('scheduler.interval_minutes')).toBe(60);
    updateSettings({ 'scheduler.interval_minutes': 120 });
    expect(getSetting<number>('scheduler.interval_minutes')).toBe(120);
  });
});

describe('isModuleEnabled', () => {
  test('returns false for disabled module', () => {
    expect(isModuleEnabled('nrc')).toBe(false);
  });

  test('returns true when enabled', () => {
    updateSettings({ 'modules.nrc.enabled': true });
    expect(isModuleEnabled('nrc')).toBe(true);
  });
});
