/** Live, opt-in proof that the Desktop OCR proxy gives DeepSeek useful image context. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  DeepSeekAdapter,
  resolveAdapterOptions,
} from '@deepseek-ai/dsh-llm-deepseek'
import { parse } from 'yaml'
import {
  DEEPSEEK_PROVIDER,
  DESKTOP_VISION_PROVIDER,
  DesktopVisionProxyAdapter,
} from '../lib/vision-proxy.js'

const imagePath = process.argv[2]
if (!imagePath) throw new Error('usage: node scripts/verify-vision-understanding.mjs <image-path>')

const credentialsPath = join(resolveDshHome(), '.credentials.yaml')
const credentials = parse(await readFile(credentialsPath, 'utf8'))
const apiKey = credentials?.DEEPSEEK_API_KEY
if (typeof apiKey !== 'string' || apiKey.length === 0) {
  throw new Error(`DEEPSEEK_API_KEY is missing from ${credentialsPath}`)
}

const connection = resolveAdapterOptions({
  thinking: 'disabled',
  reasoningEffort: 'off',
  maxTokens: 1024,
})
const official = new DeepSeekAdapter({
  options: () => connection,
  resolveApiKey: async () => apiKey,
  resolveUserId: () => 'dsh-desktop-vision-smoke',
})
const bytes = new Uint8Array(await readFile(imagePath))
const attachment = {
  attachmentId: 'vision-smoke-image',
  mediaType: 'image/png',
  bytes: bytes.byteLength,
  width: 1266,
  height: 802,
  name: 'dsh-image-reader-smoke.png',
}
const runtime = {
  listModels: provider => official.listModels(provider),
  resolveModelInfo: (provider, model, signal) => official.resolveModel(provider, model, signal),
  providerRetryPolicy: provider => official.providerRetryPolicy(provider),
  stream: options => official.stream(options),
}
const proxy = new DesktopVisionProxyAdapter(runtime, {
  async readImage(ref) { return { ref, data: bytes } },
})

let answer = ''
let failure
for await (const chunk of proxy.stream({
  provider: DESKTOP_VISION_PROVIDER,
  model: 'deepseek-v4-flash',
  maxTokens: 1024,
  messages: [createUserMessage({
    source: { kind: 'user' },
    content: [
      { type: 'text', text: 'Read the error notification visible in this image. State the problem and the recommended action. Be precise and concise.' },
      { type: 'image', attachment },
    ],
  })],
})) {
  if (chunk.type === 'text-delta') answer += chunk.text
  if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
    failure = chunk.reason.failure
  }
}
if (failure) throw new Error(`DeepSeek vision smoke failed: ${failure.code}: ${failure.message}`)

const understoodProblem = /does not support image(?:s| inputs?)|không hỗ trợ (đầu vào )?ảnh|cannot (read|process|accept) images/i.test(answer)
const understoodAction = /switch|đổi|vision-capable|supports images|hỗ trợ ảnh/i.test(answer)
if (!understoodProblem || !understoodAction) {
  throw new Error(`DeepSeek did not demonstrate image understanding. Response: ${answer}`)
}

console.log('PASS: DeepSeek understood the image error and recommended switching to an image-capable model.')
console.log(answer.trim())
