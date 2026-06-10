// ProviderIQ — Gemini LLM client wrapper
// Powered by Inquantic.Ai

import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = process.env['GEMINI_MODEL'] ?? 'gemini-3.5-flash';

let _client: GoogleGenAI | null = null;

export function getLLM(): GoogleGenAI {
  if (_client) return _client;
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Add it to the repo .env file.');
  }
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

export interface GenerateJSONOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

/**
 * Extract the first balanced JSON object/array from `text`.
 * Tolerates leading/trailing prose, markdown fences, and trailing extra JSON
 * documents (Gemini sometimes emits the response twice).
 */
function extractFirstJSON(text: string): string {
  let s = text.trim();
  // Strip ```json … ``` fences if present.
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  // Walk until the first { or [ ; then balance braces, honoring strings.
  const startIdx = s.search(/[\{\[]/);
  if (startIdx < 0) return s;
  const open = s[startIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(startIdx, i + 1);
    }
  }
  return s.slice(startIdx);
}

/**
 * Call Gemini with JSON-mode response and parse the result.
 * Throws if the response is empty, non-JSON, or the model errors out.
 */
export async function generateJSON<T = unknown>(
  prompt: string,
  options: GenerateJSONOptions = {}
): Promise<T> {
  const ai = getLLM();
  const baseTokens = options.maxOutputTokens ?? 4096;
  // Thinking models (gemini 2.5/3 flash) spend part of the token budget on
  // reasoning, which can truncate the JSON output mid-value. Retry with a
  // progressively larger budget before giving up.
  const attempts = [baseTokens, baseTokens * 2, baseTokens * 4];
  let lastError: Error | null = null;
  let lastRaw = '';

  for (const maxOutputTokens of attempts) {
    const resp = await ai.models.generateContent({
      model: options.model ?? DEFAULT_MODEL,
      contents: prompt,
      config: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens,
        responseMimeType: 'application/json',
        ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
      },
    });
    const text = resp.text ?? '';
    if (!text) {
      lastError = new Error('Empty response from Gemini');
      continue;
    }
    lastRaw = text;
    const cleaned = extractFirstJSON(text);
    try {
      return JSON.parse(cleaned) as T;
    } catch (e) {
      lastError = e as Error;
      // Retry with a bigger budget only if the failure looks like truncation.
    }
  }

  throw new Error(
    `Failed to parse JSON response: ${lastError?.message ?? 'unknown'}\nRaw (truncated): ${lastRaw.slice(0, 500)}`
  );
}

/**
 * Call Gemini with a plain text response.
 */
export async function generateText(
  prompt: string,
  options: Omit<GenerateJSONOptions, 'model'> & { model?: string } = {}
): Promise<string> {
  const ai = getLLM();
  const resp = await ai.models.generateContent({
    model: options.model ?? DEFAULT_MODEL,
    contents: prompt,
    config: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxOutputTokens ?? 1024,
      ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
    },
  });
  return resp.text ?? '';
}
