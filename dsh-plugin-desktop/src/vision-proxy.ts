/** Desktop-owned image-to-text proxy for the official text-only DeepSeek route. */

import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  LlmAdapter,
  type ContentBlock,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type Message,
  type ResolvedRetryPolicy,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  formatWindowsOcrForModel,
  recognizeWindowsImage,
  type WindowsOcrResult,
} from './windows-ocr.ts'

export const name = 'desktop-vision-proxy'
export const inject = ['llm', 'attachments']
export const DESKTOP_VISION_PROVIDER = 'deepseek-vision'
export const DEEPSEEK_PROVIDER = 'deepseek-official'

export interface VisionProxyRuntime {
  listModels(provider: string): Promise<LlmModelInfo[]>
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
  providerRetryPolicy(provider: string): ResolvedRetryPolicy
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

export interface VisionProxyAttachments {
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<{ ref: ImageAttachmentRef, data: Uint8Array }>
}

export type VisionRecognizer = (
  data: Uint8Array,
  mediaType: ImageAttachmentRef['mediaType'],
  signal?: AbortSignal,
) => Promise<WindowsOcrResult>

function proxyModel<T extends LlmModelInfo | LlmResolvedModelInfo>(model: T): T {
  return {
    ...model,
    provider: DESKTOP_VISION_PROVIDER,
    name: `${model.name} + Image Reader`,
    description: model.description === undefined
      ? 'DeepSeek with local, layout-aware Windows OCR for image attachments'
      : `${model.description} · local Windows OCR image reader`,
    inputModalities: ['text', 'image'],
  }
}

/** Adapter that converts durable image blocks to bounded OCR text before DeepSeek dispatch. */
export class DesktopVisionProxyAdapter extends LlmAdapter {
  constructor(
    private readonly runtime: VisionProxyRuntime,
    private readonly attachments: VisionProxyAttachments,
    private readonly recognize: VisionRecognizer = recognizeWindowsImage,
  ) {
    super()
  }

  override providerInfo(provider: string): { id: string, name: string } {
    return { id: provider, name: 'DeepSeek + Image Reader' }
  }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return this.runtime.providerRetryPolicy(DEEPSEEK_PROVIDER)
  }

  override async listModels(): Promise<readonly LlmModelInfo[]> {
    return (await this.runtime.listModels(DEEPSEEK_PROVIDER)).map(proxyModel)
  }

  override async resolveModel(
    _provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return proxyModel(await this.runtime.resolveModelInfo(DEEPSEEK_PROVIDER, model, signal))
  }

  private async imageText(
    ref: ImageAttachmentRef,
    signal: AbortSignal | undefined,
    cache: Map<string, Promise<string>>,
  ): Promise<string> {
    const key = ref.attachmentId as string
    const existing = cache.get(key)
    if (existing !== undefined) return existing
    const pending = (async (): Promise<string> => {
      const stored = await this.attachments.readImage(ref, signal)
      const result = await this.recognize(stored.data, stored.ref.mediaType, signal)
      return formatWindowsOcrForModel(result, stored.ref.name)
    })()
    cache.set(key, pending)
    return pending
  }

  private async transformBlocks(
    blocks: readonly ContentBlock[],
    signal: AbortSignal | undefined,
    cache: Map<string, Promise<string>>,
  ): Promise<ContentBlock[]> {
    const transformed: ContentBlock[] = []
    for (const block of blocks) {
      if (block.type === 'image') {
        transformed.push({ type: 'text', text: await this.imageText(block.attachment, signal, cache) })
      } else if (block.type === 'tool-result') {
        transformed.push({
          ...block,
          content: await this.transformBlocks(block.content, signal, cache),
        })
      } else {
        transformed.push(block)
      }
    }
    return transformed
  }

  private async transformMessages(options: GenerateOptions): Promise<Message[]> {
    const cache = new Map<string, Promise<string>>()
    return await Promise.all(options.messages.map(async message => ({
      ...message,
      content: await this.transformBlocks(message.content, options.signal, cache),
    })))
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const messages = await this.transformMessages(options)
    yield * this.runtime.stream({
      ...options,
      provider: DEEPSEEK_PROVIDER,
      messages,
    })
  }
}

/** Register the image-capable proxy beside the untouched official adapter. */
export function apply(ctx: Context): void {
  const adapter = new DesktopVisionProxyAdapter(
    ctx.llm,
    ctx.attachments as AttachmentStore,
  )
  ctx.llm.registerAdapter([DESKTOP_VISION_PROVIDER], adapter)
}
