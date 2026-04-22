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
import { NoopSandboxManager } from './sandboxManager.js';
import { type EnvironmentSanitizationConfig } from './environmentSanitization.js';

describe('ShellExecutionService (WSL2 Fix)', () => {
  it('should execute Windows binaries without hanging', async () => {
    // Detect if we are in WSL and pwsh.exe is available
    const command = 'pwsh.exe --version';
    const cwd = process.cwd();
    const abortController = new AbortController();

    const sanitizationConfig: EnvironmentSanitizationConfig = {
      allowedEnvironmentVariables: [
        'PATH',
        'HOME',
        'USER',
        'TERM',
        'ComSpec',
        'ProgramFiles',
      ],
      blockedEnvironmentVariables: [],
      enableEnvironmentVariableRedaction: true,
    };

    const sandboxManager = new NoopSandboxManager();

    const config: ShellExecutionConfig = {
      sanitizationConfig,
      sandboxManager,
      originalCommand: command,
    };

    // passing shouldUseNodePty=true normally uses pty, but our fix
    // should detect pwsh.exe and bypass it to avoid the WSL2 hang.
    const handle = await ShellExecutionService.execute(
      command,
      cwd,
      () => {},
      abortController.signal,
      true,
      config,
    );

    const result = await handle.result;

    // If the fix works, it shouldn't deadlock and we should get output.
    // If it deadlocks, this test will timeout.
    expect(result.output).toContain('PowerShell');
  }, 15000);
});
