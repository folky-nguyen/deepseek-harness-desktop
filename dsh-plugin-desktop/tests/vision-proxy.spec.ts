import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import {
  DEEPSEEK_PROVIDER,
  DESKTOP_VISION_PROVIDER,
  DesktopVisionProxyAdapter,
  type VisionProxyAttachments,
  type VisionProxyRuntime,
} from '../src/vision-proxy.ts'

function model(): LlmResolvedModelInfo {
  return {
    provider: DEEPSEEK_PROVIDER,
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    inputModalities: ['text'],
    context: { contextWindow: 128_000 },
  }
}

function fixture(): {
  adapter: DesktopVisionProxyAdapter
  runtime: VisionProxyRuntime
  attachments: VisionProxyAttachments
  streamCalls: GenerateOptions[]
  readImage: ReturnType<typeof vi.fn>
  recognize: ReturnType<typeof vi.fn>
} {
  const streamCalls: GenerateOptions[] = []
  const runtime: VisionProxyRuntime = {
    async listModels(): Promise<LlmModelInfo[]> { return [model()] },
    async resolveModelInfo(): Promise<LlmResolvedModelInfo> { return model() },
    providerRetryPolicy: () => ({
      mode: 'normal',
      maxRetries: 0,
      retryableCodes: [],
      initialDelayMs: 1,
      maxDelayMs: 1,
      jitterRatio: 0,
    }),
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      streamCalls.push(options)
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const readImage = vi.fn(async ref => ({ ref, data: new Uint8Array([1, 2, 3]) }))
  const attachments: VisionProxyAttachments = { readImage }
  const recognize = vi.fn(async () => ({
    width: 640,
    height: 480,
    angle: null,
    text: 'DSH VISION TEST 314',
    lines: [{ text: 'DSH VISION TEST 314', x: 0.1, y: 0.2, width: 0.5, height: 0.1 }],
  }))
  return {
    adapter: new DesktopVisionProxyAdapter(runtime, attachments, recognize),
    runtime,
    attachments,
    streamCalls,
    readImage,
    recognize,
  }
}

const attachment = {
  attachmentId: 'attachment-1',
  mediaType: 'image/png',
  bytes: 3,
  width: 640,
  height: 480,
  name: 'vision.png',
} as const

describe('Desktop DeepSeek vision proxy', () => {
  it('advertises the official DeepSeek catalog as image-capable', async () => {
    const { adapter } = fixture()

    expect(await adapter.listModels()).toEqual([expect.objectContaining({
      provider: DESKTOP_VISION_PROVIDER,
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash + Image Reader',
      inputModalities: ['text', 'image'],
    })])
    expect(await adapter.resolveModel(DESKTOP_VISION_PROVIDER, 'deepseek-v4-flash')).toEqual(
      expect.objectContaining({ provider: DESKTOP_VISION_PROVIDER, inputModalities: ['text', 'image'] }),
    )
  })

  it('replaces top-level and tool-result images before delegating to official DeepSeek', async () => {
    const { adapter, streamCalls, readImage, recognize } = fixture()
    const chunks: StreamChunk[] = []
    const options = {
      provider: DESKTOP_VISION_PROVIDER,
      model: 'deepseek-v4-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', attachment },
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            content: [{ type: 'image', attachment }],
          },
        ],
      }],
    } as unknown as GenerateOptions

    for await (const chunk of adapter.stream(options)) chunks.push(chunk)

    expect(chunks).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
    expect(streamCalls).toHaveLength(1)
    expect(streamCalls[0]?.provider).toBe(DEEPSEEK_PROVIDER)
    expect(streamCalls[0]?.messages[0]?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('DSH VISION TEST 314') }),
      expect.objectContaining({
        type: 'tool-result',
        content: [expect.objectContaining({ type: 'text', text: expect.stringContaining('DSH VISION TEST 314') })],
      }),
    ])
    expect(readImage).toHaveBeenCalledTimes(1)
    expect(recognize).toHaveBeenCalledTimes(1)
  })
})
