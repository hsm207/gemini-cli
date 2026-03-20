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

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: vi.fn().mockImplementation((options) => ({
        options,
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        onclose: null,
        onerror: null,
        stderr: { on: vi.fn() },
      })),
  }));

describe('Browser Privacy Integration (Total Blackout)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should flow usageStatisticsEnabled: false from settings to MCP server flags', async () => {
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
      // expected
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
});
