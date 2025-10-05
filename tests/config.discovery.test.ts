import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isDiscoveryV2Enabled, getMaxStageSeconds } from '../src/lib/config/discovery';

describe('Discovery Config', () => {
  beforeEach(() => {
    // Clear any mocked environment variables
    vi.unstubAllEnvs();
  });

  describe('isDiscoveryV2Enabled', () => {
    it('should return true by default when env var is not set', () => {
      vi.stubEnv('VITE_DISCOVERY_V2_ENABLED', undefined);
      expect(isDiscoveryV2Enabled()).toBe(true);
    });

    it('should return true when env var is "true"', () => {
      vi.stubEnv('VITE_DISCOVERY_V2_ENABLED', 'true');
      expect(isDiscoveryV2Enabled()).toBe(true);
    });

    it('should return false when env var is "false"', () => {
      vi.stubEnv('VITE_DISCOVERY_V2_ENABLED', 'false');
      expect(isDiscoveryV2Enabled()).toBe(false);
    });

    it('should handle boolean values', () => {
      vi.stubEnv('VITE_DISCOVERY_V2_ENABLED', true);
      expect(isDiscoveryV2Enabled()).toBe(true);
      
      vi.stubEnv('VITE_DISCOVERY_V2_ENABLED', false);
      expect(isDiscoveryV2Enabled()).toBe(false);
    });
  });

  describe('getMaxStageSeconds', () => {
    it('should return 60 (default) when env var is empty', () => {
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', '');
      expect(getMaxStageSeconds()).toBe(60);
    });

    it('should return 60 (default) when env var is invalid', () => {
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', 'invalid');
      expect(getMaxStageSeconds()).toBe(60);
    });

    it('should clamp 15 to minimum of 30', () => {
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', '15');
      expect(getMaxStageSeconds()).toBe(30);
    });

    it('should clamp 999 to maximum of 120', () => {
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', '999');
      expect(getMaxStageSeconds()).toBe(120);
    });

    it('should accept valid values in range', () => {
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', '45');
      expect(getMaxStageSeconds()).toBe(45);
      
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', '90');
      expect(getMaxStageSeconds()).toBe(90);
    });

    it('should handle numeric environment values', () => {
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', 75);
      expect(getMaxStageSeconds()).toBe(75);
    });

    it('should clamp exactly at boundaries', () => {
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', '30');
      expect(getMaxStageSeconds()).toBe(30);
      
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', '120');
      expect(getMaxStageSeconds()).toBe(120);
    });

    it('should return default when env var is not set', () => {
      vi.stubEnv('VITE_DISCOVERY_MAX_STAGE_SECONDS', undefined);
      expect(getMaxStageSeconds()).toBe(60);
    });
  });
});
