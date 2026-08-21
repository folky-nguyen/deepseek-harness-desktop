import { describe, expect, it } from 'vitest'
import { isolateDesktopCredentialEnvironment } from '../src/credential-environment.ts'

describe('desktop credential environment', () => {
  it('removes inherited DeepSeek keys without changing unrelated launch variables', () => {
    const environment: NodeJS.ProcessEnv = {
      PATH: 'C:\\Windows\\System32',
      DEEPSEEK_API_KEY: 'machine-wide-key',
      deepseek_api_key: 'case-insensitive-duplicate',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      ANOTHER_API_KEY: 'unrelated-key',
    }

    isolateDesktopCredentialEnvironment(environment)

    expect(environment).toEqual({
      PATH: 'C:\\Windows\\System32',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      ANOTHER_API_KEY: 'unrelated-key',
    })
  })
})
