import React from 'react';
import { theme } from '../../theme.js';

export interface ProviderTemplate {
  name: string;
  baseURL: string;
  providerType: 'openai' | 'anthropic';
  models: string[];
  custom?: boolean;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', providerType: 'openai', models: ['qwen/qwen3-235b-a22b', 'anthropic/claude-sonnet-4'] },
  { name: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', providerType: 'openai', models: ['moonshot-v1-auto'] },
  { name: 'GLM (\u667A\u8C31)', baseURL: 'https://open.bigmodel.cn/api/paas/v4', providerType: 'openai', models: ['glm-4-plus', 'glm-4-flash'] },
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', providerType: 'openai', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'Qwen (\u963F\u91CC\u4E91)', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', providerType: 'openai', models: ['qwen3-235b-a22b'] },
  { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', providerType: 'openai', models: ['gpt-4.1', 'o4-mini'] },
  { name: 'Anthropic', baseURL: 'https://api.anthropic.com', providerType: 'anthropic', models: ['claude-sonnet-4-20250514'] },
  { name: 'Custom OpenAI', baseURL: '', providerType: 'openai', models: [], custom: true },
  { name: 'Custom Anthropic', baseURL: '', providerType: 'anthropic', models: [], custom: true },
];

interface ProviderPickerProps {
  onSelect: (template: ProviderTemplate) => void;
  selectedBaseURL?: string;
}

export function ProviderPicker({ onSelect, selectedBaseURL }: ProviderPickerProps) {
  return (
    <div style={styles.grid}>
      {PROVIDER_TEMPLATES.map((t) => {
        const isSelected = !t.custom && selectedBaseURL === t.baseURL;
        return (
          <button
            key={t.name}
            style={{ ...styles.card, ...(isSelected ? styles.cardSelected : {}) }}
            onClick={() => onSelect(t)}
          >
            <span style={{ ...styles.name, color: isSelected ? 'var(--btn-primary-text, #FFFFFF)' : theme.toolName }}>{t.name}</span>
            {!t.custom && (
              <span style={{ ...styles.models, color: isSelected ? 'rgba(255,255,255,0.8)' : theme.dimText }}>{t.models.slice(0, 2).join(', ')}</span>
            )}
            {t.custom && (
              <span style={{ ...styles.customHint, color: isSelected ? 'rgba(255,255,255,0.8)' : theme.dimText }}>{t.providerType} compatible</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(16ch, 1fr))',
    gap: '0.5em',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2em',
    padding: '0.5em 0.8ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '3px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.9em',
    textAlign: 'left',
    color: 'var(--text-primary)',
  },
  cardSelected: {
    borderColor: 'var(--accent-blue)',
    background: 'var(--accent-blue)',
  },
  name: {
    fontWeight: 'bold',
    color: theme.toolName,
  },
  models: {
    color: theme.dimText,
    fontSize: '0.85em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  customHint: {
    color: theme.dimText,
    fontSize: '0.85em',
    fontStyle: 'italic',
  },
};
