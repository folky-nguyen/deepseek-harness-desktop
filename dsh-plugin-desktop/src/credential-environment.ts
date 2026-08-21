/** Environment isolation for credentials managed by DSH Desktop. */

const DEEPSEEK_API_KEY = 'DEEPSEEK_API_KEY'

/**
 * Remove an inherited DeepSeek API key before the launch-environment snapshot
 * is created. DSH Desktop owns this credential through the Harness credential
 * store, so a machine-wide key must not shadow the value saved in Settings.
 *
 * Matching is case-insensitive because Windows environment names are
 * case-insensitive even though {@link NodeJS.ProcessEnv} is a plain object.
 * @param environment - mutable Electron main-process environment.
 */
export function isolateDesktopCredentialEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === DEEPSEEK_API_KEY) delete environment[name]
  }
}
