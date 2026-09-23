// ═══════════════════════════════════════════════════════════════════════════════
// Vesper Core — Provider (Native fetch SSE streaming client)
// API function calling mode — no XML inline
// ═══════════════════════════════════════════════════════════════════════════════

import type { ApiToolCall, ToolDefinition, ThinkingConfig, SystemPromptSection } from '@vesper/shared';
import { ProxyAgent } from 'undici';
import { resolveProxyForUrl } from './proxy-util.js';

// ---------------------------------------------------------------------------
// SSE Stream Message (extended for tool_call deltas)
// ---------------------------------------------------------------------------

export type ProviderStreamMessage =
  | { type: 'content'; value: string }
  | { type: 'reasoning'; value: string }
  | { type: 'reasoning_signature'; signature: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; arguments?: string }
  | { type: 'tool_calls_done' }
  | { type: 'finish'; reason: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens?: number;
      cachedTokens?: number; cost?: number }
  | { type: 'stream_error'; error: string };

// ---------------------------------------------------------------------------
// Chat Message (OpenAI-compatible format)
// ---------------------------------------------------------------------------

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | ContentPart[];
  tool_calls?: ApiToolCall[];
  tool_call_id?: string;
  /** Whether the tool returned an error. Used to set API-level error flags. */
  isError?: boolean;
  /** Internal: accumulated reasoning text for echo-back. Not sent directly as-is. */
  _reasoning?: string;
  /** Internal: Anthropic thinking block signature for multi-turn echo-back. */
  _reasoningSignature?: string;
  /** Structured sections for Anthropic cache_control. Internal, not sent as-is. */
  _sections?: SystemPromptSection[];
}

// ---------------------------------------------------------------------------
// API Tool Definition (for request body)
// ---------------------------------------------------------------------------

export interface ApiToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * Convert internal ToolDefinition[] to API-compatible tool definitions.
 * Deduplicates by name (last occurrence wins) to prevent API errors from
 * providers like DeepSeek that reject duplicate tool names.
 */
export function toApiToolDefs(definitions: ToolDefinition[]): ApiToolDef[] {
  // Deduplicate: last occurrence wins (later definitions may have fresher state)
  const seen = new Map<string, ToolDefinition>();
  for (const def of definitions) {
    seen.set(def.name, def);
  }
  const uniqueDefs = [...seen.values()];
  
  return uniqueDefs.map((def) => ({
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }));
}

// ---------------------------------------------------------------------------
// Tool Call Accumulator
// ---------------------------------------------------------------------------

interface ToolCallSlot {
  id: string;
  name: string;
  arguments: string;
}

export class ToolCallAccumulator {
  private slots: Map<number, ToolCallSlot> = new Map();

  /**
   * Feed a tool_call delta chunk. Returns the current state of the slot.
   */
  feed(delta: { index: number; id?: string; name?: string; arguments?: string }): ToolCallSlot {
    let slot = this.slots.get(delta.index);
    if (!slot) {
      slot = { id: '', name: '', arguments: '' };
      this.slots.set(delta.index, slot);
    }

    if (delta.id) slot.id = delta.id;
    if (delta.name) slot.name += delta.name;
    if (delta.arguments) slot.arguments += delta.arguments;

    return slot;
  }

  /**
   * Flush all accumulated tool calls as ApiToolCall[].
   */
  flush(): ApiToolCall[] {
    const result: ApiToolCall[] = [];
    const sortedKeys = [...this.slots.keys()].sort((a, b) => a - b);
    for (const key of sortedKeys) {
      const slot = this.slots.get(key)!;
      result.push({
        id: slot.id,
        type: 'function',
        function: { name: slot.name, arguments: slot.arguments },
      });
    }
    this.slots.clear();
    return result;
  }

  get size(): number {
    return this.slots.size;
  }
}

// ---------------------------------------------------------------------------
// SSE Line Parser
// ---------------------------------------------------------------------------

interface SSEParserState {
  buffer: string;
}

function createSSEParser(): SSEParserState {
  return { buffer: '' };
}

/**
 * Feed raw bytes into the SSE parser, yield parsed JSON data payloads.
 * Returns an array of parsed objects (or null for [DONE] sentinel).
 */
function feedSSE(parser: SSEParserState, chunk: string): (Record<string, any> | null)[] {
  parser.buffer += chunk;
  const results: (Record<string, any> | null)[] = [];

  let boundary: number;
  while ((boundary = parser.buffer.indexOf('\n')) !== -1) {
    const line = parser.buffer.substring(0, boundary).trim();
    parser.buffer = parser.buffer.substring(boundary + 1);

    if (!line.startsWith('data:')) continue;

    const jsonStr = line.substring(5).trim();
    if (jsonStr === '[DONE]') {
      results.push(null);
      continue;
    }

    try {
      results.push(JSON.parse(jsonStr));
    } catch {
      // Incomplete JSON chunk — skip
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Extract deltas from SSE payload (returns multiple messages)
// ---------------------------------------------------------------------------

function extractDeltas(parsed: Record<string, any>): ProviderStreamMessage[] {
  const messages: ProviderStreamMessage[] = [];

  // Usage data (may appear on a chunk without choices — OpenAI sends it as a separate final chunk)
  if (parsed.usage) {
    const cachedTokens = parsed.usage.prompt_tokens_details?.cached_tokens as number | undefined;
    messages.push({
      type: 'usage',
      promptTokens: parsed.usage.prompt_tokens ?? 0,
      completionTokens: parsed.usage.completion_tokens ?? 0,
      totalTokens: parsed.usage.total_tokens,
      cachedTokens: cachedTokens ?? undefined,
      cost: typeof parsed.usage.cost === 'number' ? parsed.usage.cost : undefined,
    });
  }

  const choice = parsed.choices?.[0];
  if (!choice) return messages;

  const delta = choice.delta;
  if (!delta) return messages;

  // Content delta
  if (delta.content) {
    messages.push({ type: 'content', value: delta.content });
  }

  // Reasoning / thinking delta (various provider field names)
  const reasoning = delta.reasoning ?? delta.reasoning_content ?? delta.thinking;
  if (reasoning) {
    messages.push({ type: 'reasoning', value: reasoning });
  }

  // Tool call deltas
  if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      messages.push({
        type: 'tool_call_delta',
        index: tc.index ?? 0,
        id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments,
      });
    }
  }

  // Finish reason
  const finishReason = choice.finish_reason;
  if (finishReason) {
    messages.push({ type: 'finish', reason: finishReason });
    // Signal that the model finished a tool-call turn so the runtime can
    // proceed to execute the accumulated tool calls. Without this the
    // runtime's `hasToolCalls` flag stays false and the calls are dropped.
    if (finishReason === 'tool_calls') {
      messages.push({ type: 'tool_calls_done' });
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// createStream — Main export
// ---------------------------------------------------------------------------

export interface CreateStreamOptions {
  model: string;
  baseURL: string;
  apiKey: string;
  messages: ChatMessage[];
  tools?: ApiToolDef[];
  signal?: AbortSignal;
  proxy?: string;
  maxTokens?: number;
  providerType?: 'openai' | 'anthropic';
  thinking?: ThinkingConfig;
  /** OpenRouter provider slug for forced routing (e.g. "anthropic", "fireworks"). */
  specificProvider?: string;
}

/**
 * Create a streaming async generator that yields content/reasoning/tool_call_delta
 * chunks from the LLM provider via OpenAI-compatible API.
 *
 * The fetch + HTTP status check execute eagerly (on await), so callers can
 * catch HTTP errors (429, 500, 524 …) immediately for retry logic.
 * The returned async generator lazily streams SSE body chunks.
 */
export async function createStream(
  options: CreateStreamOptions,
): Promise<AsyncGenerator<ProviderStreamMessage>> {
  if (options.providerType === 'anthropic') {
    return createAnthropicStream(options);
  }

  const { model, baseURL, apiKey, messages, tools, signal, proxy, maxTokens, thinking } = options;

  // Prepare messages: map _reasoning to echoField for OpenAI-compatible providers.
  // Only echo when the user explicitly enabled echo — 'enabled' only controls whether
  // to send the thinking toggle in the API request, not whether to echo reasoning back.
  const { specificProvider } = options;
  const mustEchoReasoning = thinking?.echo;
  const echoField = thinking?.echoField ?? 'reasoning_content';
  let wireMessages: Record<string, any>[] = messages.map(msg => {
    if (msg._reasoning && mustEchoReasoning) {
      const { _reasoning, _reasoningSignature, ...rest } = msg;
      return { ...rest, [echoField]: _reasoning };
    }
    // Strip _reasoning / _reasoningSignature if present but echo is disabled
    if (msg._reasoning) {
      const { _reasoning, _reasoningSignature, ...rest } = msg;
      return rest;
    }
    return msg;
  });

  // DeepSeek thinking mode requires reasoning_content on every assistant message
  // that has tool_calls. Synthetic assistant messages (time awareness, link injection,
  // malformed tool calls) are generated by the framework without _reasoning.
  // When echo is enabled, patch these with an empty string to satisfy the API contract.
  if (mustEchoReasoning) {
    for (const msg of wireMessages) {
      if (msg.role === 'assistant' && msg.tool_calls?.length && !(echoField in msg)) {
        msg[echoField] = '';
      }
    }
  }

  const body: Record<string, any> = {
    model,
    messages: wireMessages,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  if (maxTokens) {
    body.max_tokens = maxTokens;
  }

  // Enable thinking if configured
  if (thinking?.enabled) {
    body.enable_thinking = true;
  }
  // OpenAI o-series reasoning effort
  if (thinking?.effort) {
    body.reasoning_effort = thinking.effort;
  }

  // OpenRouter: force-route to a specific provider slug
  if (specificProvider) {
    body.provider = { order: [specificProvider], allow_fallbacks: false };
  }

  const url = `${baseURL}/chat/completions`;
  const opts: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  };

  // ── Eager fetch — errors thrown here are catchable by streamWithRetry ──
  let response: Response;
  // A proxy cannot reach a loopback/LAN endpoint — bypass it for private hosts.
  const effectiveProxy = resolveProxyForUrl(proxy, baseURL);
  if (effectiveProxy) {
    const dispatcher = new ProxyAgent(effectiveProxy);
    // Dynamic import for undici's fetch with proxy support
    const undici = await import('undici');
    response = await (undici as any).fetch(url, { ...opts, dispatcher }) as unknown as Response;
  } else {
    response = await fetch(url, opts);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Provider request failed [${response.status}]: ${text}`);
  }

  if (!response.body) {
    throw new Error('Provider returned no response body');
  }

  // ── Lazy SSE body streaming ──
  const reader = response.body.getReader();
  return (async function* () {
    const decoder = new TextDecoder();
    const parser = createSSEParser();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const payloads = feedSSE(parser, text);

        for (const payload of payloads) {
          if (payload === null) return; // [DONE]

          const msgs = extractDeltas(payload);
          for (const msg of msgs) {
            yield msg;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  })();
}

// ═══════════════════════════════════════════════════════════════════════════
// Anthropic Messages API Support
// All translation logic is encapsulated here — the rest of the runtime
// continues to use OpenAI-format ChatMessage[].
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Anthropic Types (internal)
// ---------------------------------------------------------------------------

interface AnthropicContentBlock {
  type: string;
  [key: string]: any;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Message Converter: OpenAI ChatMessage[] → Anthropic format
// ---------------------------------------------------------------------------

function convertMessagesForAnthropic(
  messages: ChatMessage[],
): { system: string | AnthropicContentBlock[] | undefined; messages: AnthropicMessage[] } {
  let system: string | AnthropicContentBlock[] | undefined;
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    // Extract system message as top-level field
    if (msg.role === 'system') {
      // When _sections are present, build structured system with cache_control breakpoints
      if (msg._sections && msg._sections.length > 0) {
        system = msg._sections.map(section => {
          const block: AnthropicContentBlock = { type: 'text', text: section.content };
          if (section.cacheBreakpoint) {
            block.cache_control = { type: 'ephemeral' };
          }
          return block;
        });
      } else {
        system = typeof msg.content === 'string' ? msg.content : '';
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const contentBlocks: AnthropicContentBlock[] = [];

      // Add thinking block if reasoning content is present (for echo-back).
      // Anthropic native API requires a `signature` field; third-party compatible
      // providers (OpenRouter, proxies) are generally lenient and ignore unknown fields.
      // Strategy: always send the thinking block; attach signature when available.
      if (msg._reasoning) {
        const thinkingBlock: AnthropicContentBlock = {
          type: 'thinking',
          thinking: msg._reasoning,
        };
        if (msg._reasoningSignature) {
          thinkingBlock.signature = msg._reasoningSignature;
        }
        contentBlocks.push(thinkingBlock);
      }

      // Add text content if present
      if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
        contentBlocks.push({ type: 'text', text: msg.content });
      }

      // Convert tool_calls to tool_use blocks
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, any> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            // Leave as empty object
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }

      if (contentBlocks.length > 0) {
        result.push({ role: 'assistant', content: contentBlocks });
      }
      continue;
    }

    if (msg.role === 'tool') {
      // Tool results become user messages with tool_result content blocks
      const toolResultBlock: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id!,
        content: typeof msg.content === 'string' ? msg.content : '',
        ...(msg.isError ? { is_error: true } : {}),
      };
      // Check if previous message is a user message we can merge into
      const prev = result[result.length - 1];
      if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
        (prev.content as AnthropicContentBlock[]).push(toolResultBlock);
      } else {
        result.push({ role: 'user', content: [toolResultBlock] });
      }
      continue;
    }

    if (msg.role === 'user') {
      // Handle ContentPart[] (images) or plain string
      if (Array.isArray(msg.content)) {
        const blocks: AnthropicContentBlock[] = [];
        for (const part of msg.content) {
          if (part.type === 'text') {
            blocks.push({ type: 'text', text: part.text });
          } else if (part.type === 'image_url') {
            const url = part.image_url.url;
            // Parse data: URI → base64 source
            const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/);
            if (dataMatch) {
              blocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: dataMatch[1],
                  data: dataMatch[2],
                },
              });
            } else {
              // URL-based image
              blocks.push({
                type: 'image',
                source: { type: 'url', url },
              });
            }
          }
        }

        // Merge into previous user message if possible
        const prev = result[result.length - 1];
        if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
          (prev.content as AnthropicContentBlock[]).push(...blocks);
        } else {
          result.push({ role: 'user', content: blocks });
        }
      } else {
        const text = typeof msg.content === 'string' ? msg.content : '';
        // Merge into previous user message if possible
        const prev = result[result.length - 1];
        if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
          (prev.content as AnthropicContentBlock[]).push({ type: 'text', text });
        } else {
          result.push({ role: 'user', content: text });
        }
      }
      continue;
    }
  }

  // ── Cache optimization: place cache_control breakpoint on last user turn ──
  // Anthropic allows cache_control on the last content block of any user turn.
  // When placed, the entire prefix up to that block is cached. On the NEXT LLM
  // call (after another tool round), the prefix matches and cache hits.
  //
  // Breakpoint budget (Anthropic limit: 4 per request):
  //   BP1: system — after static sections (§1-§7)
  //   BP2: system — after semi-static sections (§8-§12)
  //   BP3: tools  — last tool definition (stable across entire session)
  //   BP4: messages — last user turn (caches conversation prefix for next call)
  if (result.length > 0) {
    let lastUserIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }

    if (lastUserIdx >= 0) {
      const msg = result[lastUserIdx];
      if (typeof msg.content === 'string') {
        msg.content = [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }];
      } else if (Array.isArray(msg.content) && msg.content.length > 0) {
        const lastBlock = msg.content[msg.content.length - 1] as AnthropicContentBlock;
        lastBlock.cache_control = { type: 'ephemeral' };
      }
    }
  }

  // ── Final safety net: validate tool_use / tool_result pairing ──
  // Anthropic requires that every tool_use block in an assistant message has a
  // corresponding tool_result in the immediately following user message.
  // If any are missing (due to framework bugs, race conditions, etc.), inject
  // synthetic error tool_results to prevent a 400 error from the API.
  for (let i = 0; i < result.length; i++) {
    const msg = result[i];
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;

    // Collect all tool_use ids (and their names) in this assistant message
    const toolUseEntries: { id: string; name: string }[] = [];
    for (const block of msg.content as AnthropicContentBlock[]) {
      if (block.type === 'tool_use' && block.id) {
        toolUseEntries.push({ id: block.id, name: block.name ?? 'unknown' });
      }
    }
    if (toolUseEntries.length === 0) continue;

    // Find corresponding tool_results in the next message(s)
    const foundResultIds = new Set<string>();
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].role !== 'user') break;
      if (!Array.isArray(result[j].content)) break;
      for (const block of result[j].content as AnthropicContentBlock[]) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          foundResultIds.add(block.tool_use_id);
        }
      }
      // Only check the immediately following user message(s) that contain tool_results
      const hasNonToolResult = (result[j].content as AnthropicContentBlock[]).some(
        b => b.type !== 'tool_result',
      );
      if (hasNonToolResult) break;
    }

    // Inject missing tool_results with informative error messages
    const missingEntries = toolUseEntries.filter(e => !foundResultIds.has(e.id));
    if (missingEntries.length > 0) {
      process.stderr.write(
        `[provider] WARNING: Injecting ${missingEntries.length} missing tool_result(s) for tool_use ids: ${missingEntries.map(e => `${e.id}(${e.name})`).join(', ')}\n`,
      );
      const buildErrorContent = (entry: { id: string; name: string }) =>
        `Error: tool "${entry.name}" (call id: ${entry.id}) did not return a result. ` +
        `This is a framework-level error — the tool call was issued but its result was lost ` +
        `due to an internal error or interrupted execution. You may retry this tool call.`;

      // Find or create the user message immediately after the assistant
      const nextIdx = i + 1;
      if (nextIdx < result.length && result[nextIdx].role === 'user' && Array.isArray(result[nextIdx].content)) {
        // Prepend missing results to existing user message
        const existing = result[nextIdx].content as AnthropicContentBlock[];
        for (const entry of missingEntries) {
          existing.unshift({
            type: 'tool_result',
            tool_use_id: entry.id,
            content: buildErrorContent(entry),
            is_error: true,
          });
        }
      } else {
        // Insert a new user message with the missing tool_results
        const missingBlocks: AnthropicContentBlock[] = missingEntries.map(entry => ({
          type: 'tool_result',
          tool_use_id: entry.id,
          content: buildErrorContent(entry),
          is_error: true,
        }));
        result.splice(nextIdx, 0, { role: 'user', content: missingBlocks });
      }
    }
  }

  return { system, messages: result };
}

// ---------------------------------------------------------------------------
// Tool Converter: ApiToolDef[] → AnthropicToolDef[]
// ---------------------------------------------------------------------------

function toAnthropicToolDefs(tools: ApiToolDef[]): AnthropicToolDef[] {
  const result = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
  // BP3: cache_control on last tool definition.
  // Tool schemas are completely stable across the entire session (~5-6k tokens),
  // so caching them avoids re-processing on every API call.
  if (result.length > 0) {
    (result[result.length - 1] as any).cache_control = { type: 'ephemeral' };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Anthropic SSE Parser
// ---------------------------------------------------------------------------

interface AnthropicSSEState {
  buffer: string;
  currentEvent: string;
  // Map content block index → type (text, tool_use, thinking)
  blockTypes: Map<number, string>;
  // Map content block index → tool_use id
  blockToolIds: Map<number, string>;
  // Accumulated usage
  inputTokens: number;
  outputTokens: number;
  // Cache usage (Anthropic prompt caching)
  cacheCreationTokens: number;
  cacheReadTokens: number;
  // Cost (OpenRouter reports this in message_delta)
  cost: number;
}

function createAnthropicSSEParser(): AnthropicSSEState {
  return {
    buffer: '',
    currentEvent: '',
    blockTypes: new Map(),
    blockToolIds: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cost: 0,
  };
}

function feedAnthropicSSE(
  state: AnthropicSSEState,
  chunk: string,
): ProviderStreamMessage[] {
  state.buffer += chunk;
  const messages: ProviderStreamMessage[] = [];

  let boundary: number;
  while ((boundary = state.buffer.indexOf('\n')) !== -1) {
    const line = state.buffer.substring(0, boundary).trim();
    state.buffer = state.buffer.substring(boundary + 1);

    if (line === '') {
      // Empty line = end of event, reset
      state.currentEvent = '';
      continue;
    }

    if (line.startsWith('event:')) {
      state.currentEvent = line.substring(6).trim();
      continue;
    }

    if (!line.startsWith('data:')) continue;

    const jsonStr = line.substring(5).trim();
    if (!jsonStr) continue;

    let data: Record<string, any>;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      continue;
    }

    const eventType = state.currentEvent || data.type || '';
    switch (eventType) {
      case 'message_start': {
        // Extract input tokens from message.usage
        const usage = data.message?.usage;
        if (usage) {
          state.inputTokens = usage.input_tokens ?? 0;
          state.outputTokens = usage.output_tokens ?? 0;
          state.cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
          state.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
        }
        break;
      }

      case 'content_block_start': {
        const index = data.index ?? 0;
        const block = data.content_block;
        if (block) {
          state.blockTypes.set(index, block.type);
          if (block.type === 'tool_use') {
            state.blockToolIds.set(index, block.id ?? '');
            // Emit initial tool_call_delta with id and name
            messages.push({
              type: 'tool_call_delta',
              index,
              id: block.id,
              name: block.name,
            });
          }
        }
        break;
      }

      case 'content_block_delta': {
        const index = data.index ?? 0;
        const delta = data.delta;
        if (!delta) break;

        const blockType = state.blockTypes.get(index);

        if (delta.type === 'text_delta') {
          if (blockType === 'thinking') {
            messages.push({ type: 'reasoning', value: delta.text ?? '' });
          } else {
            messages.push({ type: 'content', value: delta.text ?? '' });
          }
        } else if (delta.type === 'thinking_delta') {
          messages.push({ type: 'reasoning', value: delta.thinking ?? '' });
        } else if (delta.type === 'input_json_delta') {
          messages.push({
            type: 'tool_call_delta',
            index,
            arguments: delta.partial_json ?? '',
          });
        }
        break;
      }

      case 'content_block_stop': {
        // Capture thinking block signature for multi-turn echo-back.
        // Anthropic returns the signature in content_block_stop for thinking blocks:
        //   { "type": "content_block_stop", "index": 0,
        //     "content_block": { "type": "thinking", "signature": "..." } }
        const stopIndex = data.index ?? 0;
        const stopBlock = data.content_block;
        if (stopBlock?.type === 'thinking' && stopBlock.signature) {
          messages.push({ type: 'reasoning_signature', signature: stopBlock.signature });
        }
        break;
      }

      case 'message_delta': {
        // Usage update — Anthropic direct sends output_tokens here;
        // OpenRouter may also send input_tokens and cache tokens here
        // (instead of in message_start)
        if (data.usage) {
          state.outputTokens = data.usage.output_tokens ?? state.outputTokens;
          if (data.usage.input_tokens) {
            state.inputTokens = data.usage.input_tokens;
          }
          if (data.usage.cache_creation_input_tokens) {
            state.cacheCreationTokens = data.usage.cache_creation_input_tokens;
          }
          if (data.usage.cache_read_input_tokens) {
            state.cacheReadTokens = data.usage.cache_read_input_tokens;
          }
          if (typeof data.usage.cost === 'number') {
            state.cost = data.usage.cost;
          }
        }
        const stopReason = data.delta?.stop_reason;
        if (stopReason) {
          // Normalize: end_turn → stop, tool_use → tool_calls
          let reason = stopReason;
          if (reason === 'end_turn') reason = 'stop';
          if (reason === 'tool_use') reason = 'tool_calls';
          messages.push({ type: 'finish', reason });
        }
        break;
      }

      case 'message_stop': {
        // Emit final usage.
        // For Anthropic/OpenRouter:
        //   input_tokens        = non-cached prompt tokens
        //   cache_read_input    = cached (hit) tokens
        //   cache_creation_input = newly written to cache tokens
        //   total prompt        = input + cache_read + cache_creation
        //
        // promptTokens MUST be the real total because it feeds:
        //   - lastRealPromptTokens → shouldDrift() and token budget display
        // cachedTokens reports the cache_read portion so StatusBar can compute
        // cache rate = cached / total.
        const totalPromptTokens = state.inputTokens + state.cacheReadTokens + state.cacheCreationTokens;
        if (totalPromptTokens > 0 || state.outputTokens > 0) {
          messages.push({
            type: 'usage',
            promptTokens: totalPromptTokens,
            completionTokens: state.outputTokens,
            cachedTokens: state.cacheReadTokens > 0 ? state.cacheReadTokens : undefined,
            cost: state.cost > 0 ? state.cost : undefined,
          });
        }
        break;
      }

      case 'error': {
        const errMsg = data.error?.message ?? JSON.stringify(data);
        messages.push({ type: 'stream_error', error: `Anthropic API error: ${errMsg}` });
        break;
      }

      // ping, etc. — ignore
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// createAnthropicStream — Anthropic Messages API streaming
// ---------------------------------------------------------------------------

async function createAnthropicStream(
  options: CreateStreamOptions,
): Promise<AsyncGenerator<ProviderStreamMessage>> {
  const { model, baseURL, apiKey, messages, tools, signal, proxy, maxTokens, thinking } = options;

  // Convert messages
  const converted = convertMessagesForAnthropic(messages);

  // Build request body
  const body: Record<string, any> = {
    model,
    messages: converted.messages,
    stream: true,
    max_tokens: maxTokens ?? 8192,
  };

  if (converted.system) {
    body.system = converted.system;
  }

  if (tools && tools.length > 0) {
    body.tools = toAnthropicToolDefs(tools);
  }

  // Enable Anthropic extended thinking if configured
  if (thinking?.enabled) {
    body.thinking = { type: 'enabled', budget_tokens: maxTokens ?? 8192 };
  }

  // OpenRouter: force-route to a specific provider slug
  if (options.specificProvider) {
    body.provider = { order: [options.specificProvider], allow_fallbacks: false };
  }

  // Anthropic uses /messages endpoint
  let url: string;
  if (baseURL.endsWith('/v1')) {
    url = `${baseURL}/messages`;
  } else if (baseURL.endsWith('/v1/')) {
    url = `${baseURL}messages`;
  } else {
    url = `${baseURL.replace(/\/+$/, '')}/v1/messages`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
  };

  const opts: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  };

  // ── Eager fetch — errors thrown here are catchable by streamWithRetry ──
  let response: Response;
  // A proxy cannot reach a loopback/LAN endpoint — bypass it for private hosts.
  const effectiveProxy = resolveProxyForUrl(proxy, baseURL);
  if (effectiveProxy) {
    const dispatcher = new ProxyAgent(effectiveProxy);
    // Dynamic import for undici's fetch with proxy support
    const undici = await import('undici');
    response = await (undici as any).fetch(url, { ...opts, dispatcher }) as unknown as Response;
  } else {
    response = await fetch(url, opts);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Provider request failed [${response.status}]: ${text}`);
  }

  if (!response.body) {
    throw new Error('Provider returned no response body');
  }

  // ── Lazy SSE body streaming ──
  const reader = response.body.getReader();
  return (async function* () {
    const decoder = new TextDecoder();
    const parser = createAnthropicSSEParser();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const msgs = feedAnthropicSSE(parser, text);

        for (const msg of msgs) {
          yield msg;
        }
      }
    } finally {
      reader.releaseLock();
    }
  })();
}
