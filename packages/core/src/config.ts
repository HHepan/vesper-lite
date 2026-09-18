// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Global Config File (~/.vesper/config.json)
// ═══════════════════════════════════════════════════════════════════════════

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { VesperConfig, VesperProfileConfig, ThinkingConfig } from '@vesper/shared';
import { stripBOM } from '@vesper/shared';
import { resolveProxyForUrl } from './proxy-util.js';

export function getConfigPath(): string {
  return join(homedir(), '.vesper', 'config.json');
}

export async function loadGlobalConfig(): Promise<VesperConfig | null> {
  const configPath = getConfigPath();
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    return null;
  }

  try {
    raw = stripBOM(raw);
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      process.stderr.write(`[config] Warning: ${configPath} is not a valid config object.\n`);
      return null;
    }
    return parsed as VesperConfig;
  } catch {
    process.stderr.write(`[config] Warning: ${configPath} contains invalid JSON.\n`);
    return null;
  }
}

export interface ResolvedConfig {
  model: string;
  apiKey: string;
  baseURL: string;
  user_name: string | undefined;
  maxIterations: number;
  maxTokens: number;
  proxy: string | undefined;
  prompts: string | undefined;
  noTools: boolean;
  toolset: string | undefined;
  supportsVision: boolean;
  providerType: 'openai' | 'anthropic';
  thinking: ThinkingConfig;
  specificProvider: string | undefined;
  profileName: string | undefined;
  injectCanvasHistory?: boolean;
  timeRefreshInterval?: string;
}

export interface CliArgs {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  user_name?: string;
  maxIterations?: number;
  maxTokens?: number;
  proxy?: string;
  prompts?: string;
  noTools?: boolean;
  profile?: string;
  toolset?: string;
}

export interface EnvVars {
  VESPER_MODEL?: string;
  VESPER_API_KEY?: string;
  VESPER_BASE_URL?: string;
  VESPER_USER_NAME?: string;
}

export function inferProviderType(baseURL: string, model: string): 'openai' | 'anthropic' {
  if (baseURL.includes('anthropic.com')) return 'anthropic';
  if (model.startsWith('claude-')) return 'anthropic';
  return 'openai';
}

export function resolveEffectiveConfig(
  cli: CliArgs,
  env: EnvVars,
  globalConfig: VesperConfig | null,
  projectConfig?: VesperConfig | null,
): ResolvedConfig {
  const profileName = cli.profile ?? projectConfig?.defaultProfile ?? globalConfig?.defaultProfile;
  const mergedProfiles = {
    ...globalConfig?.profiles,
    ...projectConfig?.profiles,
  };
  const profile = profileName && mergedProfiles[profileName]
    ? mergedProfiles[profileName]
    : undefined;

  const model = (
    cli.model
    ?? env.VESPER_MODEL
    ?? profile?.model
    ?? 'gpt-4o'
  ).trim();

  const apiKey = (
    cli.apiKey
    ?? env.VESPER_API_KEY
    ?? profile?.apiKey
    ?? ''
  ).trim();

  const baseURL = (
    cli.baseURL
    ?? env.VESPER_BASE_URL
    ?? profile?.baseURL
    ?? 'https://api.openai.com/v1'
  ).trim();

  const user_name = (
    cli.user_name
    ?? env.VESPER_USER_NAME
    ?? globalConfig?.user_name
    ?? 'User'
  ).trim();

  return {
    model,
    apiKey,
    baseURL,
    user_name,
    maxIterations:
      cli.maxIterations
      ?? profile?.maxIterations
      ?? projectConfig?.maxIterations
      ?? globalConfig?.maxIterations
      ?? -1,
    maxTokens:
      cli.maxTokens
      ?? profile?.maxCanvasTokens
      ?? projectConfig?.maxTokens
      ?? globalConfig?.maxTokens
      ?? 200000,
    proxy:
      (cli.proxy ?? profile?.proxy ?? globalConfig?.proxy)?.trim() || undefined,
    prompts:
      cli.prompts
      ?? globalConfig?.prompts,
    noTools: cli.noTools ?? false,
    toolset:
      cli.toolset
      ?? globalConfig?.defaultToolset
      ?? undefined,
    supportsVision:
      profile?.supportsVision
      ?? projectConfig?.supportsVision
      ?? globalConfig?.supportsVision
      ?? true,
    providerType:
      profile?.providerType
      ?? globalConfig?.providerType
      ?? inferProviderType(baseURL, model),
    thinking: {
      ...globalConfig?.thinking,
      ...profile?.thinking,
    },
    specificProvider:
      profile?.specificProvider
      ?? undefined,
    profileName,
    injectCanvasHistory:
      projectConfig?.injectCanvasHistory
      ?? globalConfig?.injectCanvasHistory
      ?? false,
    timeRefreshInterval:
      projectConfig?.timeRefreshInterval
      ?? globalConfig?.timeRefreshInterval
      ?? '1h',
  };
}

export function listProfiles(
  globalConfig: VesperConfig | null,
  projectConfig?: VesperConfig | null,
): Array<{ name: string; model?: string; baseURL?: string; isDefault: boolean }> {
  const mergedProfiles = {
    ...globalConfig?.profiles,
    ...projectConfig?.profiles,
  };
  const defaultProfile = projectConfig?.defaultProfile ?? globalConfig?.defaultProfile;
  return Object.entries(mergedProfiles).map(([name, profile]) => ({
    name,
    model: profile.model,
    baseURL: profile.baseURL,
    isDefault: name === defaultProfile,
  }));
}
