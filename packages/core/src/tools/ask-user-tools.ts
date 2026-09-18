// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Ask User Tool (sentinel pattern)
// Allows the LLM agent to ask structured questions to the user during
// execution. Runtime intercepts the sentinel and blocks on user response.
// ═══════════════════════════════════════════════════════════════════════════

import type { ToolEntry, ToolResult, AskUserQuestion } from '@vesper/shared';

// ---------------------------------------------------------------------------
// Sentinel Interface
// ---------------------------------------------------------------------------

export interface AskUserOp {
  __askUserOp: 'ask';
  questions: AskUserQuestion[];
}

// ---------------------------------------------------------------------------
// Sentinel Detection
// ---------------------------------------------------------------------------

export function parseAskUserOp(result: ToolResult): AskUserOp | null {
  try {
    const parsed = JSON.parse(result.content);
    if (parsed && parsed.__askUserOp) {
      return parsed as AskUserOp;
    }
  } catch {
    // Not an ask_user op sentinel
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool Entry
// ---------------------------------------------------------------------------

export function createAskUserTools(): ToolEntry[] {
  return [
    {
      definition: {
        name: 'ask_user',
        description:
          'Ask the user a question and wait for their response. ' +
          'Use this when you need clarification, want to validate assumptions, ' +
          'or need the user to make a decision. ' +
          'Each question has 2-4 options; the user can also provide custom text.',
        parameters: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: {
                type: 'object',
                properties: {
                  question: {
                    type: 'string',
                    description: 'The question to ask the user. Should be clear and end with a question mark.',
                  },
                  header: {
                    type: 'string',
                    description: 'Short label (max 12 chars) displayed as a tag, e.g. "Auth method", "Library".',
                    maxLength: 12,
                  },
                  options: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 4,
                    items: {
                      type: 'object',
                      properties: {
                        label: {
                          type: 'string',
                          description: 'Display text for this option (1-5 words).',
                        },
                        description: {
                          type: 'string',
                          description: 'Explanation of what this option means.',
                        },
                        markdown: {
                          type: 'string',
                          description: 'Optional preview content shown when this option is focused.',
                        },
                      },
                      required: ['label', 'description'],
                    },
                  },
                  multiSelect: {
                    type: 'boolean',
                    description: 'If true, the user can select multiple options. Default: false.',
                  },
                },
                required: ['question', 'header', 'options'],
              },
            },
          },
          required: ['questions'],
        },
      },
      executor: async (args) => {
        const questions = args.questions as AskUserQuestion[];
        const sentinel: AskUserOp = {
          __askUserOp: 'ask',
          questions,
        };
        return { content: JSON.stringify(sentinel) };
      },
    },
  ];
}
