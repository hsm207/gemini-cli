/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Config, type ConfigParameters } from '../config/config.js';
import { ApprovalMode } from '../policy/types.js';
import { ToolRegistry, DiscoveredTool } from './tool-registry.js';
import { DISCOVERED_TOOL_PREFIX } from './tool-names.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { ToolErrorType } from './tool-error.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

vi.mock('node:fs');

// Mock node:child_process
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
    spawn: vi.fn(),
  };
});

// Helper to create a mock spawn process for tool discovery
const createDiscoveryProcess = (toolDeclarations: any[]) => {
  const mockProcess = {
    stdout: { on: vi.fn(), removeListener: vi.fn() },
    stderr: { on: vi.fn(), removeListener: vi.fn() },
    on: vi.fn(),
  };

  mockProcess.stdout.on.mockImplementation((event, callback) => {
    if (event === 'data') {
      callback(
        Buffer.from(
          JSON.stringify([{ functionDeclarations: toolDeclarations }]),
        ),
      );
    }
    return mockProcess as any;
  });

  mockProcess.on.mockImplementation((event, callback) => {
    if (event === 'close') {
      callback(0);
    }
    return mockProcess as any;
  });

  return mockProcess;
};

// Helper to create a mock spawn process for tool execution
const createExecutionProcess = (
  exitCode: number,
  stderrMessage?: string,
  stdoutMessage?: string,
) => {
  const mockProcess = {
    stdout: { on: vi.fn(), removeListener: vi.fn() },
    stderr: { on: vi.fn(), removeListener: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
    on: vi.fn(),
    connected: true,
    disconnect: vi.fn(),
    removeListener: vi.fn(),
  };

  if (stderrMessage) {
    mockProcess.stderr.on.mockImplementation((event, callback) => {
      if (event === 'data') {
        callback(Buffer.from(stderrMessage));
      }
    });
  }

  if (stdoutMessage) {
    mockProcess.stdout.on.mockImplementation((event, callback) => {
      if (event === 'data') {
        callback(Buffer.from(stdoutMessage));
      }
    });
  }

  mockProcess.on.mockImplementation((event, callback) => {
    if (event === 'close') {
      callback(exitCode);
    }
  });

  return mockProcess;
};

const baseConfigParams: ConfigParameters = {
  cwd: '/tmp',
  model: 'test-model',
  embeddingModel: 'test-embedding-model',
  sandbox: undefined,
  targetDir: '/test/dir',
  debugMode: false,
  userMemory: '',
  geminiMdFileCount: 0,
  approvalMode: ApprovalMode.DEFAULT,
  sessionId: 'test-session-id',
};

describe('ToolRegistry (Alpha Pro Streaming)', () => {
  let config: Config;
  let toolRegistry: ToolRegistry;
  const mockMessageBus = {
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  } as unknown as MessageBus;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
    } as fs.Stats);
    config = new Config(baseConfigParams);
    toolRegistry = new ToolRegistry(config, mockMessageBus);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Alpha Pro Failure Handling', () => {
    it('should return a DISCOVERED_TOOL_EXECUTION_ERROR on tool failure (Exit Code 2)', async () => {
      vi.spyOn(config, 'getToolDiscoveryCommand').mockReturnValue('discovery');
      vi.spyOn(config, 'getToolCallCommand').mockReturnValue('call');

      const toolDeclaration = {
        name: 'failing-tool',
        description: 'A tool that fails',
        parametersJsonSchema: { type: 'object', properties: {} },
      };

      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockReturnValueOnce(
        createDiscoveryProcess([toolDeclaration]) as any,
      );

      await toolRegistry.discoverAllTools();
      const tool = toolRegistry.getTool(
        DISCOVERED_TOOL_PREFIX + 'failing-tool',
      );

      mockSpawn.mockReturnValueOnce(
        createExecutionProcess(2, 'Something went wrong') as any,
      );

      const invocation = (tool as DiscoveredTool).build({});
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error?.type).toBe(
        ToolErrorType.DISCOVERED_TOOL_EXECUTION_ERROR,
      );
      expect(result.llmContent).toContain('Stderr: Something went wrong');
      expect(result.llmContent).toContain('Exit Code: 2');
    });
  });

  describe('Alpha Pro Streaming Features', () => {
    it('should support canUpdateOutput from discovery', async () => {
      vi.spyOn(config, 'getToolDiscoveryCommand').mockReturnValue('discovery');

      const toolDeclaration = {
        name: 'streaming-tool',
        description: 'A tool that streams',
        parametersJsonSchema: { type: 'object', properties: {} },
        canUpdateOutput: true,
      };

      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockReturnValueOnce(
        createDiscoveryProcess([toolDeclaration]) as any,
      );

      await toolRegistry.discoverAllTools();
      const tool = toolRegistry.getTool(
        DISCOVERED_TOOL_PREFIX + 'streaming-tool',
      );
      expect(tool?.canUpdateOutput).toBe(true);
    });

    it('should call updateOutput during execution for stdout and stderr', async () => {
      vi.spyOn(config, 'getToolCallCommand').mockReturnValue('call');

      const tool = new DiscoveredTool(
        config,
        'streaming-tool',
        DISCOVERED_TOOL_PREFIX + 'streaming-tool',
        'A tool that streams',
        {},
        mockMessageBus,
        true, // canUpdateOutput
      );

      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockReturnValueOnce(
        createExecutionProcess(0, 'Progress', 'Live update') as any,
      );

      const updateOutput = vi.fn();
      const invocation = tool.build({});
      await invocation.execute(new AbortController().signal, updateOutput);

      expect(updateOutput).toHaveBeenCalledWith('Live update');
      expect(updateOutput).toHaveBeenCalledWith('Progress');
    });
  });
});
