// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContent = vi.fn();
const ctor = vi.fn();

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent };
      constructor(opts: unknown) {
        ctor(opts);
      }
    },
  };
});

import { geminiGenerateJson } from "@/lib/infrastructure/llm/server/gemini-client";

const baseReq = {
  apiKey: "k1",
  model: "gemini-flash-latest",
  systemInstruction: "sys",
  userContent: "user",
  responseJsonSchema: { type: "object" },
  maxOutputTokens: 100,
  thinkingLevel: "low" as const,
  timeoutMs: 1000,
  signal: new AbortController().signal,
};

describe("geminiGenerateJson (SDK adapter, mocked)", () => {
  beforeEach(() => {
    generateContent.mockReset();
    ctor.mockReset();
  });

  it("calls generateContent with structured JSON output and no SDK retries", async () => {
    generateContent.mockResolvedValue({
      text: '{"a":1}',
      candidates: [{ finishReason: "STOP" }],
    });
    const out = await geminiGenerateJson(baseReq);
    expect(out).toEqual({ text: '{"a":1}', blocked: false, truncated: false });
    expect(ctor).toHaveBeenCalledWith({ apiKey: "k1" });
    const arg = generateContent.mock.calls[0][0];
    expect(arg.model).toBe("gemini-flash-latest");
    expect(arg.contents).toBe("user");
    expect(arg.config).toMatchObject({
      systemInstruction: "sys",
      responseMimeType: "application/json",
      responseJsonSchema: { type: "object" },
      temperature: 0,
      maxOutputTokens: 100,
      httpOptions: { timeout: 1000, retryOptions: { attempts: 1 } },
    });
    expect(arg.config.abortSignal).toBe(baseReq.signal);
    expect(arg.config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
  });

  it("omits thinkingConfig when the level is off", async () => {
    generateContent.mockResolvedValue({ text: "{}" });
    await geminiGenerateJson({ ...baseReq, thinkingLevel: "off" });
    expect(
      generateContent.mock.calls[0][0].config.thinkingConfig
    ).toBeUndefined();
  });

  it("reports safety blocks and truncation", async () => {
    generateContent.mockResolvedValue({
      text: undefined,
      promptFeedback: { blockReason: "SAFETY" },
    });
    expect((await geminiGenerateJson(baseReq)).blocked).toBe(true);
    generateContent.mockResolvedValue({
      text: '{"a":',
      candidates: [{ finishReason: "MAX_TOKENS" }],
    });
    expect((await geminiGenerateJson(baseReq)).truncated).toBe(true);
  });

  it("propagates SDK errors (status is mapped by the handler)", async () => {
    generateContent.mockRejectedValue(
      Object.assign(new Error("quota"), { status: 429 })
    );
    await expect(geminiGenerateJson(baseReq)).rejects.toMatchObject({
      status: 429,
    });
  });
});
