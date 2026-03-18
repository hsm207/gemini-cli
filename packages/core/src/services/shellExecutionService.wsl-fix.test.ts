/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  ShellExecutionService,
  type ShellExecutionConfig,
} from './shellExecutionService.js';
import {
  type SandboxManager,
  type SandboxRequest,
  type SandboxedCommand,
} from './sandboxManager.js';
import { type EnvironmentSanitizationConfig } from './environmentSanitization.js';

describe('ShellExecutionService (WSL2 Fix)', () => {
  it('should execute Windows binaries without hanging', async () => {
    const command = 'pwsh --version';
    const cwd = process.cwd();
    const abortController = new AbortController();

    const sanitizationConfig: EnvironmentSanitizationConfig = {
      allowedEnvironmentVariables: ['PATH', 'HOME', 'USER', 'TERM'],
      blockedEnvironmentVariables: [],
      enableEnvironmentVariableRedaction: true,
    };

    const sandboxManager: SandboxManager = {
      prepareCommand: async (
        req: SandboxRequest,
      ): Promise<SandboxedCommand> => ({
        program: req.command,
        args: req.args,
        env: req.env,
        cwd: req.cwd,
      }),
    };

    const config: ShellExecutionConfig = {
      sanitizationConfig,
      sandboxManager,
    };

    // passing shouldUseNodePty=true triggers the fallback logic for Windows binaries
    const handle = await ShellExecutionService.execute(
      command,
      cwd,
      () => {},
      abortController.signal,
      true,
      config,
    );

    const result = await handle.result;
    expect(result.output).toContain('PowerShell 7.5.4');
  }, 10000);
});
