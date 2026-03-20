/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadCliConfig, type CliArgs } from './config.js';
import { createTestMergedSettings } from './settings.js';
import { BrowserManager } from '../../../core/src/agents/browser/browserManager.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// We use a conditional mock to allow the "Bot-Wall" test to use the real transport
// while the "Blackout" test intercepts the flags.
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@modelcontextprotocol/sdk/client/stdio.js')
    >();
  return {
    ...actual,
    StdioClientTransport: vi.fn().mockImplementation((options) => {
      // If we are in "Intercept Mode", return a dummy transport
      if (globalThis.__INTERCEPT_MCP__) {
        return {
          options,
          connect: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          onclose: null,
          onerror: null,
          stderr: { on: vi.fn() },
        };
      }
      // Otherwise, return the real thing!
      return new actual.StdioClientTransport(options);
    }),
  };
});

describe('Browser Privacy & Bot-Detection Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__INTERCEPT_MCP__ = false;
  });

  it('should flow "usageStatisticsEnabled: false" from settings to MCP server flags', async () => {
    globalThis.__INTERCEPT_MCP__ = true;

    const settings = createTestMergedSettings({
      privacy: {
        usageStatisticsEnabled: false,
      },
    });

    const mockArgv = {
      debug: false,
      sandbox: false,
      prompt: '',
      yes: true,
    } as unknown as CliArgs;

    const config = await loadCliConfig(settings, 'test-session', mockArgv, {
      cwd: process.cwd(),
    });

    const browserManager = new BrowserManager(config);
    try {
      await browserManager.getRawMcpClient();
    } catch {
      // expected connection failure in intercept mode
    }

    const transportConstructorCalls =
      vi.mocked(StdioClientTransport).mock.calls;
    expect(transportConstructorCalls.length).toBeGreaterThan(0);
    const transportOptions = transportConstructorCalls[0][0];
    const args = transportOptions.args as string[];

    expect(args).toContain('--no-usage-statistics');
    expect(args).toContain('--no-performance-crux');
    // eslint-disable-next-line no-console
    console.log('🌑 [BLACKOUT VERIFIED] MCP Args:', args.join(' '));
  });

  it('should bypass Google bot-detection using the "Human Mask" stealth flags', async () => {
    // 1. Arrange: Real config with stealth and isolated profile active
    const settings = createTestMergedSettings({
      privacy: {
        usageStatisticsEnabled: false,
      },
      agents: {
        browser: {
          headless: false, // Force headed mode for authentic bot-detection testing
          sessionMode: 'isolated', // FORCE A NAKED PROFILE for every test run
          allowedDomains: [], // Total Liberation
        },
      },
    });

    const mockArgv = {
      debug: false,
      sandbox: true,
      prompt: '',
      yes: true,
    } as unknown as CliArgs;
    const config = await loadCliConfig(settings, 'test-session', mockArgv, {
      cwd: process.cwd(),
    });

    const browserManager = new BrowserManager(config);

    try {
      // 2. Act: Navigate to Google Search (The "War Zone")
      // eslint-disable-next-line no-console
      console.log(
        '🕵️‍♀️ [STEALTH TEST] Navigating to Google Search with a NAKED profile...',
      );

      const client = await browserManager.getRawMcpClient();

      // We manually execute the search via CDP/Tool calls
      await client.callTool({
        name: 'navigate_page',
        arguments: {
          url: 'https://www.google.com/search?q=price+of+bitcoin+in+usd',
        },
      });

      // 3. Assert: Capture a snapshot and verify humanity!
      const result = await client.callTool({
        name: 'take_snapshot',
        arguments: {},
      });

      const output = JSON.stringify(result);

      // THE "GOLDEN PROOF": The bot-wall text should NOT be in the output!
      expect(output).not.toContain('unusual traffic');
      expect(output).not.toContain('About this page');

      // Verify we actually reached the results (should contain Bitcoin or USD)
      expect(output.toLowerCase()).toMatch(/bitcoin|usd|finance|price/);

      // eslint-disable-next-line no-console
      console.log(
        '🎭 [STEALTH VERIFIED] Google search successful! Bot-wall bypassed.',
      );
    } finally {
      await browserManager.close();
    }
  }, 30000); // Higher timeout for real browser interaction
});

// Type declaration for the intercept flag
declare global {
  var __INTERCEPT_MCP__: boolean;
}
