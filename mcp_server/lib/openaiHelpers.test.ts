/**
 * Unit tests for OpenAI helper functions
 * Ensures correct parameter families for Responses API vs Chat Completions API
 */

import { describe, it, expect } from 'vitest';
import { buildOpenAIBody, supportsCustomTemperature } from './openaiHelpers';

describe('buildOpenAIBody', () => {
  const baseMessages = [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello' }
  ];

  describe('Responses API family', () => {
    it('should include text.format.type === "json" for responses API', () => {
      const body = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'responses',
        messages: baseMessages,
        maxTokens: 100,
        temperature: 0.7
      });

      expect(body.text).toBeDefined();
      expect(body.text.format).toBeDefined();
      expect(body.text.format.type).toBe('json');
    });

    it('should NOT include response_format for responses API', () => {
      const body = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'responses',
        messages: baseMessages
      });

      expect(body.response_format).toBeUndefined();
    });

    it('should use input field for messages', () => {
      const body = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'responses',
        messages: baseMessages
      });

      expect(body.input).toBeDefined();
      expect(body.input).toEqual(baseMessages);
      expect(body.messages).toBeUndefined();
    });

    it('should use max_output_tokens for responses API', () => {
      const body = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'responses',
        messages: baseMessages,
        maxTokens: 500
      });

      expect(body.max_output_tokens).toBe(500);
      expect(body.max_tokens).toBeUndefined();
    });
  });

  describe('Chat Completions API family', () => {
    it('should include response_format.type === "json_object" for chat API', () => {
      const body = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'chat',
        messages: baseMessages,
        maxTokens: 100,
        temperature: 0.7
      });

      expect(body.response_format).toBeDefined();
      expect(body.response_format.type).toBe('json_object');
    });

    it('should NOT include text.format for chat API', () => {
      const body = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'chat',
        messages: baseMessages
      });

      expect(body.text).toBeUndefined();
    });

    it('should use messages field for chat API', () => {
      const body = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'chat',
        messages: baseMessages
      });

      expect(body.messages).toBeDefined();
      expect(body.messages).toEqual(baseMessages);
      expect(body.input).toBeUndefined();
    });

    it('should use max_tokens for chat API', () => {
      const body = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'chat',
        messages: baseMessages,
        maxTokens: 500
      });

      expect(body.max_tokens).toBe(500);
      expect(body.max_output_tokens).toBeUndefined();
    });

    it('should include tools and tool_choice when provided', () => {
      const tools = [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} }
          }
        }
      ];
      const tool_choice = { type: 'function', function: { name: 'test_tool' } };

      const body = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'chat',
        messages: baseMessages,
        tools,
        tool_choice
      });

      expect(body.tools).toEqual(tools);
      expect(body.tool_choice).toEqual(tool_choice);
    });
  });

  describe('Model field', () => {
    it('should always include model field', () => {
      const responsesBody = buildOpenAIBody({
        model: 'gpt-4o-mini',
        apiFamily: 'responses',
        messages: baseMessages
      });

      const chatBody = buildOpenAIBody({
        model: 'gpt-5-2025-08-07',
        apiFamily: 'chat',
        messages: baseMessages
      });

      expect(responsesBody.model).toBe('gpt-4o-mini');
      expect(chatBody.model).toBe('gpt-5-2025-08-07');
    });
  });
});

describe('supportsCustomTemperature', () => {
  describe('Models that do NOT support custom temperature', () => {
    it('should return false for gpt-5 models', () => {
      expect(supportsCustomTemperature('gpt-5')).toBe(false);
      expect(supportsCustomTemperature('gpt-5-mini')).toBe(false);
      expect(supportsCustomTemperature('gpt-5-2025-08-07')).toBe(false);
      expect(supportsCustomTemperature('gpt-5-mini-2025-08-07')).toBe(false);
    });

    it('should return false for o3/o4 reasoning models', () => {
      expect(supportsCustomTemperature('o3')).toBe(false);
      expect(supportsCustomTemperature('o3-2025-04-16')).toBe(false);
      expect(supportsCustomTemperature('o4-mini')).toBe(false);
      expect(supportsCustomTemperature('o4-mini-2025-04-16')).toBe(false);
    });

    it('should return false for vision-preview models', () => {
      expect(supportsCustomTemperature('gpt-4-vision-preview')).toBe(false);
      expect(supportsCustomTemperature('gpt-4o-vision-preview')).toBe(false);
    });
  });

  describe('Models that DO support custom temperature', () => {
    it('should return true for gpt-4o models', () => {
      expect(supportsCustomTemperature('gpt-4o')).toBe(true);
      expect(supportsCustomTemperature('gpt-4o-mini')).toBe(true);
      expect(supportsCustomTemperature('gpt-4o-2024-08-06')).toBe(true);
    });

    it('should return true for gpt-4.1 models', () => {
      expect(supportsCustomTemperature('gpt-4.1')).toBe(true);
      expect(supportsCustomTemperature('gpt-4.1-mini')).toBe(true);
      expect(supportsCustomTemperature('gpt-4.1-2025-04-14')).toBe(true);
    });

    it('should return true for legacy gpt-4 models', () => {
      expect(supportsCustomTemperature('gpt-4')).toBe(true);
      expect(supportsCustomTemperature('gpt-4-turbo')).toBe(true);
    });
  });
});

describe('Temperature handling in buildOpenAIBody', () => {
  const baseMessages = [
    { role: 'system', content: 'Test' },
    { role: 'user', content: 'Test' }
  ];

  it('should NOT include temperature for vision-preview models', () => {
    const body = buildOpenAIBody({
      model: 'gpt-4-vision-preview',
      apiFamily: 'chat',
      messages: baseMessages,
      temperature: 0.7
    });

    expect(body.temperature).toBeUndefined();
  });

  it('should NOT include temperature for gpt-5 models', () => {
    const body = buildOpenAIBody({
      model: 'gpt-5-2025-08-07',
      apiFamily: 'chat',
      messages: baseMessages,
      temperature: 0.5
    });

    expect(body.temperature).toBeUndefined();
  });

  it('should NOT include temperature for o3/o4 models', () => {
    const o3Body = buildOpenAIBody({
      model: 'o3-2025-04-16',
      apiFamily: 'chat',
      messages: baseMessages,
      temperature: 0.8
    });

    const o4Body = buildOpenAIBody({
      model: 'o4-mini-2025-04-16',
      apiFamily: 'chat',
      messages: baseMessages,
      temperature: 0.8
    });

    expect(o3Body.temperature).toBeUndefined();
    expect(o4Body.temperature).toBeUndefined();
  });

  it('should include temperature for models that support it', () => {
    const body = buildOpenAIBody({
      model: 'gpt-4o-mini',
      apiFamily: 'chat',
      messages: baseMessages,
      temperature: 0.7
    });

    expect(body.temperature).toBe(0.7);
  });

  it('should not include temperature when undefined, even for supporting models', () => {
    const body = buildOpenAIBody({
      model: 'gpt-4o-mini',
      apiFamily: 'chat',
      messages: baseMessages,
      temperature: undefined
    });

    expect(body.temperature).toBeUndefined();
  });
});

describe('Integration: Full parameter validation', () => {
  it('should build valid Responses API payload', () => {
    const body = buildOpenAIBody({
      model: 'gpt-4o',
      apiFamily: 'responses',
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' }
      ],
      maxTokens: 1500,
      temperature: 0.7
    });

    // Has correct fields for Responses API
    expect(body.model).toBe('gpt-4o');
    expect(body.input).toBeDefined();
    expect(body.text.format.type).toBe('json');
    expect(body.max_output_tokens).toBe(1500);
    expect(body.temperature).toBe(0.7);

    // Does NOT have Chat API fields
    expect(body.messages).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it('should build valid Chat Completions API payload', () => {
    const body = buildOpenAIBody({
      model: 'gpt-4o-mini',
      apiFamily: 'chat',
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' }
      ],
      maxTokens: 1000,
      temperature: 0.5
    });

    // Has correct fields for Chat API
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toBeDefined();
    expect(body.response_format.type).toBe('json_object');
    expect(body.max_tokens).toBe(1000);
    expect(body.temperature).toBe(0.5);

    // Does NOT have Responses API fields
    expect(body.input).toBeUndefined();
    expect(body.text).toBeUndefined();
    expect(body.max_output_tokens).toBeUndefined();
  });
});
