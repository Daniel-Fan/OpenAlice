import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { api, type AppConfig, type AIProviderConfig, type LoginMethod } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, inputClass } from '../components/form'
import { useAutoSave, type SaveStatus } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/StateViews'

const LOGIN_METHODS: { value: LoginMethod; label: string; subtitle: string; hint: string }[] = [
  { value: 'claudeai', label: 'Claude Pro/Max', subtitle: 'Use your Claude subscription', hint: 'Requires local Claude Code login (run claude login in terminal). No API key needed.' },
  { value: 'api-key', label: 'API Key', subtitle: 'Pay per token', hint: 'Enter your Anthropic API key below. Billed per token to your API account.' },
]

const PROVIDER_MODELS: Record<string, { label: string; value: string }[]> = {
  anthropic: [
    { label: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
    { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
    { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
  ],
  openai: [
    { label: 'GPT-5.2 Pro', value: 'gpt-5.2-pro' },
    { label: 'GPT-5.2', value: 'gpt-5.2' },
    { label: 'GPT-5 Mini', value: 'gpt-5-mini' },
  ],
  'openai-codex': [
    { label: 'GPT-5.3 Codex', value: 'gpt-5.3-codex' },
    { label: 'GPT-5.4', value: 'gpt-5.4' },
    { label: 'GPT-5.2 Codex', value: 'gpt-5.2-codex' },
    { label: 'GPT-5.1 Codex', value: 'gpt-5.1-codex' },
    { label: 'GPT-5.1 Codex Max', value: 'gpt-5.1-codex-max' },
    { label: 'GPT-5.1 Codex Mini', value: 'gpt-5.1-codex-mini' },
    { label: 'GPT-5.2', value: 'gpt-5.2' },
    { label: 'GPT-5.1', value: 'gpt-5.1' },
  ],
  google: [
    { label: 'Gemini 3.1 Pro', value: 'gemini-3.1-pro-preview' },
    { label: 'Gemini 3 Flash', value: 'gemini-3-flash-preview' },
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
  ],
}

const OPENAI_LOGIN_METHODS: { value: LoginMethod; label: string; subtitle: string; hint: string }[] = [
  { value: 'chatgpt-oauth', label: 'ChatGPT Plus/Pro', subtitle: 'Use your ChatGPT subscription', hint: 'Login with your ChatGPT Plus/Pro account to use Codex backend models. No API key needed.' },
  { value: 'api-key', label: 'API Key', subtitle: 'Pay per token', hint: 'Enter your OpenAI Platform API key. Billed per token to your API account.' },
]

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'custom', label: 'Custom' },
]

const SDK_FORMATS = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic Compatible' },
  { value: 'google', label: 'Google Compatible' },
]

/** Detect whether saved config should show as "Custom" in the UI. */
function detectCustomMode(provider: string, model: string): boolean {
  const presets = PROVIDER_MODELS[provider]
  if (!presets) return true
  return !presets.some((p) => p.value === model)
}

/** UI-level backend. 'openai' is a facade over vercel-ai-sdk with provider=openai. */
type UIBackend = 'agent-sdk' | 'openai' | 'vercel-ai-sdk'

/** Default provider/model per UI backend — applied on every switch to avoid stale config. */
const BACKEND_DEFAULTS: Record<UIBackend, { backend: string; provider: string; model: string }> = {
  'agent-sdk':    { backend: 'agent-sdk',    provider: 'anthropic', model: 'claude-sonnet-4-6' },
  'openai':       { backend: 'vercel-ai-sdk', provider: 'openai',   model: PROVIDER_MODELS.openai[0].value },
  'vercel-ai-sdk': { backend: 'vercel-ai-sdk', provider: 'anthropic', model: PROVIDER_MODELS.anthropic[0].value },
}

/** Derive initial UI backend from config. */
function detectUIBackend(config: AIProviderConfig): UIBackend {
  if (config.backend === 'vercel-ai-sdk' && config.provider === 'openai') return 'openai'
  if (config.backend === 'vercel-ai-sdk') return 'vercel-ai-sdk'
  return 'agent-sdk'
}

function BackendCard({ selected, onClick, icon, title, description }: {
  selected: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start gap-2 p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
        selected
          ? 'border-accent bg-accent-dim/50'
          : 'border-border bg-bg hover:border-text-muted/30 hover:bg-bg-tertiary'
      }`}
    >
      <div className={`${selected ? 'text-accent' : 'text-text-muted'}`}>{icon}</div>
      <div>
        <p className={`text-[13px] font-semibold ${selected ? 'text-accent' : 'text-text'}`}>{title}</p>
        <p className="text-[11px] text-text-muted mt-0.5 leading-snug">{description}</p>
      </div>
    </button>
  )
}

export function AIProviderPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => {})
  }, [])

  const uiBackend: UIBackend = config ? detectUIBackend(config.aiProvider) : 'agent-sdk'

  const handleBackendSwitch = useCallback(
    async (target: UIBackend) => {
      if (!config) return
      try {
        const defaults = BACKEND_DEFAULTS[target]
        const updated = { ...config.aiProvider, ...defaults }
        await api.config.updateSection('aiProvider', updated)
        setConfig((c) => c ? { ...c, aiProvider: updated } : c)
      } catch {
        // Button state reflects actual saved state
      }
    },
    [config],
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="AI Provider" description="Configure the AI backend, model, and API keys." />

      {config ? (
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
          <div className="max-w-[880px] mx-auto">
            {/* Backend */}
            <ConfigSection title="Backend" description="Changes take effect immediately.">
              <div className="grid grid-cols-3 gap-3">
                <BackendCard
                  selected={uiBackend === 'agent-sdk'}
                  onClick={() => handleBackendSwitch('agent-sdk')}
                  icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a4 4 0 0 1 4-4z" /><path d="M8 8v2a4 4 0 0 0 8 0V8" /><path d="M12 14v4" /><path d="M8 22h8" /><circle cx="9" cy="5.5" r="0.5" fill="currentColor" stroke="none" /><circle cx="15" cy="5.5" r="0.5" fill="currentColor" stroke="none" /></svg>}
                  title="Claude"
                  description="Claude Code login or Anthropic API key"
                />
                <BackendCard
                  selected={uiBackend === 'openai'}
                  onClick={() => handleBackendSwitch('openai')}
                  icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>}
                  title="OpenAI"
                  description="GPT models via OpenAI API"
                />
                <BackendCard
                  selected={uiBackend === 'vercel-ai-sdk'}
                  onClick={() => handleBackendSwitch('vercel-ai-sdk')}
                  icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                  title="Vercel AI SDK"
                  description="Multi-provider, custom endpoints"
                />
              </div>
            </ConfigSection>

            {/* Auth mode (only for Agent SDK) */}
            {uiBackend === 'agent-sdk' && (
              <ConfigSection title="Authentication" description="Choose how Alice connects to Claude.">
                <AgentSdkAuthForm aiProvider={config.aiProvider} onUpdate={(patch) => setConfig((c) => c ? { ...c, aiProvider: { ...c.aiProvider, ...patch } } : c)} />
              </ConfigSection>
            )}

            {/* OpenAI auth + model */}
            {uiBackend === 'openai' && (
              <>
                <ConfigSection title="Authentication" description="Choose how Alice connects to OpenAI.">
                  <OpenAIAuthForm aiProvider={config.aiProvider} onUpdate={(patch) => setConfig((c) => c ? { ...c, aiProvider: { ...c.aiProvider, ...patch } } : c)} />
                </ConfigSection>
                <ConfigSection title="Model" description="Select a model. Changes take effect on the next request.">
                  <OpenAIForm aiProvider={config.aiProvider} />
                </ConfigSection>
              </>
            )}

            {/* Full model form (only for Vercel AI SDK) */}
            {uiBackend === 'vercel-ai-sdk' && (
              <ConfigSection title="Model" description="Provider, model, and API keys. Changes take effect on the next request.">
                <ModelForm aiProvider={config.aiProvider} />
              </ConfigSection>
            )}
          </div>
      </div>
      ) : (
        <PageLoading />
      )}
    </div>
  )
}

// ==================== OpenAI Form (model selection — login-method-aware) ====================

function OpenAIForm({ aiProvider }: { aiProvider: AIProviderConfig }) {
  const isChatGPT = aiProvider.loginMethod === 'chatgpt-oauth'
  const presets = isChatGPT ? PROVIDER_MODELS['openai-codex'] : PROVIDER_MODELS.openai
  const initModel = aiProvider.provider === 'openai' && aiProvider.model ? aiProvider.model : presets[0].value
  const isPreset = presets.some((p) => p.value === initModel)

  const [model, setModel] = useState(isPreset ? initModel : '')
  const [customModel, setCustomModel] = useState(isPreset ? '' : initModel)
  const [baseUrl, setBaseUrl] = useState(aiProvider.baseUrl || '')
  const [reasoningEffort, setReasoningEffort] = useState(aiProvider.reasoningEffort || '')
  const [apiKey, setApiKey] = useState('')
  const [keySaveStatus, setKeySaveStatus] = useState<SaveStatus>('idle')
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset model when login method changes
  useEffect(() => {
    const newPresets = isChatGPT ? PROVIDER_MODELS['openai-codex'] : PROVIDER_MODELS.openai
    if (!newPresets.some((p) => p.value === model) && model !== '') {
      setModel(newPresets[0].value)
      setCustomModel('')
    }
  }, [isChatGPT]) // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveModel = model || customModel

  // Auto-save model + baseUrl + reasoningEffort
  const modelData = useMemo(
    () => ({
      ...aiProvider,
      provider: 'openai',
      model: effectiveModel,
      ...(baseUrl && !isChatGPT ? { baseUrl } : { baseUrl: undefined }),
      ...(reasoningEffort ? { reasoningEffort } : { reasoningEffort: undefined }),
    }),
    [aiProvider, effectiveModel, baseUrl, isChatGPT, reasoningEffort],
  )

  const saveModel = useCallback(async (data: Record<string, unknown>) => {
    await api.config.updateSection('aiProvider', data)
  }, [])

  const { status: modelStatus, retry: modelRetry } = useAutoSave({
    data: modelData,
    save: saveModel,
  })

  const hasKey = !!aiProvider.apiKeys?.openai

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  const handleSaveKey = async () => {
    if (!apiKey) return
    setKeySaveStatus('saving')
    try {
      const updatedKeys = { ...aiProvider.apiKeys, openai: apiKey }
      await api.config.updateSection('aiProvider', { ...aiProvider, apiKeys: updatedKeys })
      setApiKey('')
      setKeySaveStatus('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setKeySaveStatus('idle'), 2000)
    } catch { setKeySaveStatus('error') }
  }

  const handleModelSelect = (value: string) => {
    if (value === '__custom__') {
      setModel('')
      setCustomModel('')
    } else {
      setModel(value)
      setCustomModel('')
    }
  }

  return (
    <>
      <Field label="Model">
        <select
          className={inputClass}
          value={model || '__custom__'}
          onChange={(e) => handleModelSelect(e.target.value)}
        >
          {presets.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
          <option value="__custom__">Custom...</option>
        </select>
      </Field>

      {!model && (
        <Field label="Custom Model ID">
          <input
            className={inputClass}
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder={isChatGPT ? 'e.g. gpt-5.2-codex' : 'e.g. gpt-4o, o3-pro'}
          />
        </Field>
      )}

      <Field label="Reasoning Effort" description="Configure reasoning effort for O-series or Codex API.">
        <select
          className={inputClass}
          value={reasoningEffort}
          onChange={(e) => setReasoningEffort(e.target.value)}
        >
          <option value="">Default</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="extra_high">Extra High (Codex Max)</option>
        </select>
      </Field>

      {/* API key + base URL only for standard OpenAI API key mode */}
      {!isChatGPT && (
        <>
          <Field label="API Key">
            <div className="relative">
              <input
                className={inputClass}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '(configured)' : 'sk-...'}
              />
              {hasKey && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-green">active</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={handleSaveKey}
                disabled={!apiKey || keySaveStatus === 'saving'}
                className="btn-primary"
              >
                Save Key
              </button>
              <SaveIndicator status={keySaveStatus} onRetry={handleSaveKey} />
            </div>
          </Field>

          <Field label="Base URL" description="Leave empty for the official OpenAI API. Set for proxies or compatible endpoints (e.g. Azure OpenAI).">
            <input
              className={inputClass}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </Field>
        </>
      )}

      <SaveIndicator status={modelStatus} onRetry={modelRetry} />
    </>
  )
}

// ==================== OpenAI Auth Form (ChatGPT OAuth / API Key) ====================

function OpenAIAuthForm({ aiProvider, onUpdate }: { aiProvider: AIProviderConfig; onUpdate: (patch: Partial<AIProviderConfig>) => void }) {
  const [loginMethod, setLoginMethod] = useState<LoginMethod>(aiProvider.loginMethod ?? 'api-key')
  const [authStatus, setAuthStatus] = useState<{ authenticated: boolean; accountId?: string } | null>(null)
  const [loginState, setLoginState] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle')
  const [loginError, setLoginError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check auth status on mount
  useEffect(() => {
    api.chatgptAuth.status().then(setAuthStatus).catch(() => {})
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleLoginMethodChange = async (method: LoginMethod) => {
    setLoginMethod(method)
    try {
      await api.config.updateSection('aiProvider', { ...aiProvider, loginMethod: method })
      onUpdate({ loginMethod: method })
    } catch { setLoginMethod(loginMethod) }
  }

  const handleLogin = async () => {
    setLoginState('waiting')
    setLoginError('')
    try {
      const { url, autoMode } = await api.chatgptAuth.start()

      if (!autoMode) {
        // Manual mode: user needs to paste URL — show the URL
        const code = window.prompt(
          'A browser window should have opened. After logging in, paste the redirect URL here:',
          '',
        )
        if (code) {
          const result = await api.chatgptAuth.callback(code)
          if (result.success) {
            setLoginState('success')
            setAuthStatus({ authenticated: true, accountId: result.accountId })
          } else {
            setLoginState('error')
            setLoginError(result.error || 'Login failed')
          }
        } else {
          setLoginState('idle')
        }
        return
      }

      // Auto mode: poll for callback
      pollRef.current = setInterval(async () => {
        try {
          const result = await api.chatgptAuth.poll()
          if (result.pending) return // Still waiting
          if (pollRef.current) clearInterval(pollRef.current)
          if (result.success) {
            setLoginState('success')
            setAuthStatus({ authenticated: true, accountId: result.accountId })
          } else {
            setLoginState('error')
            setLoginError(result.error || 'Login failed')
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current)
          setLoginState('error')
          setLoginError('Polling failed')
        }
      }, 1000)

      // Timeout after 60s
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setLoginState('error')
          setLoginError('Login timed out. Please try again.')
        }
      }, 60_000)
    } catch (err) {
      setLoginState('error')
      setLoginError(err instanceof Error ? err.message : 'Failed to start login')
    }
  }

  const handleLogout = async () => {
    try {
      await api.chatgptAuth.logout()
      setAuthStatus({ authenticated: false })
      setLoginState('idle')
    } catch { /* ignore */ }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {OPENAI_LOGIN_METHODS.map((m) => (
          <BackendCard
            key={m.value}
            selected={loginMethod === m.value}
            onClick={() => handleLoginMethodChange(m.value)}
            icon={m.value === 'chatgpt-oauth'
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}
            title={m.label}
            description={m.subtitle}
          />
        ))}
      </div>
      <p className="text-[11px] text-text-muted mt-2">
        {OPENAI_LOGIN_METHODS.find((m) => m.value === loginMethod)?.hint}
      </p>

      {loginMethod === 'chatgpt-oauth' && (
        <div className="mt-3 space-y-3">
          {authStatus?.authenticated ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-green/10 border border-green/20 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-green" />
                <span className="text-[12px] text-green font-medium">
                  Connected
                </span>
                {authStatus.accountId && (
                  <span className="text-[11px] text-text-muted ml-1">
                    ({authStatus.accountId.slice(0, 8)}…)
                  </span>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="text-[12px] text-text-muted hover:text-red transition-colors"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={handleLogin}
                disabled={loginState === 'waiting'}
                className="btn-primary flex items-center gap-2"
              >
                {loginState === 'waiting' ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                    Waiting for login…
                  </>
                ) : (
                  'Login with ChatGPT'
                )}
              </button>
              {loginState === 'error' && (
                <span className="text-[11px] text-red">{loginError}</span>
              )}
              {loginState === 'success' && (
                <span className="text-[11px] text-green">Login successful!</span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ==================== Model Form (full Vercel AI SDK) ====================

function ModelForm({ aiProvider }: { aiProvider: AIProviderConfig }) {
  // Detect whether saved config should render as "Custom" in the UI
  const initCustom = detectCustomMode(aiProvider.provider || 'anthropic', aiProvider.model || '')
  const [uiProvider, setUiProvider] = useState(initCustom ? 'custom' : (aiProvider.provider || 'anthropic'))
  const [sdkProvider, setSdkProvider] = useState(aiProvider.provider || 'openai')
  const [model, setModel] = useState(aiProvider.model || '')
  const [customModel, setCustomModel] = useState(initCustom ? (aiProvider.model || '') : '')
  const [baseUrl, setBaseUrl] = useState(aiProvider.baseUrl || '')
  const [showKeys, setShowKeys] = useState(false)
  const [keys, setKeys] = useState({ anthropic: '', openai: '', google: '' })
  const [keySaveStatus, setKeySaveStatus] = useState<SaveStatus>('idle')
  const keySavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isCustomMode = uiProvider === 'custom'
  const effectiveProvider = isCustomMode ? sdkProvider : uiProvider
  const presets = PROVIDER_MODELS[uiProvider] || []
  const isCustomModelInStandard = !isCustomMode && model !== '' && !presets.some((p) => p.value === model)
  const effectiveModel = isCustomMode
    ? customModel
    : (isCustomModelInStandard ? customModel || model : model)

  // Auto-save model/provider/baseUrl (but NOT apiKeys — those use manual save)
  const modelData = useMemo(
    () => ({
      ...aiProvider,
      provider: effectiveProvider,
      model: effectiveModel,
      ...(baseUrl ? { baseUrl } : { baseUrl: undefined }),
    }),
    [aiProvider, effectiveProvider, effectiveModel, baseUrl],
  )

  const saveModel = useCallback(async (data: Record<string, unknown>) => {
    await api.config.updateSection('aiProvider', data)
  }, [])

  const { status: modelStatus, retry: modelRetry } = useAutoSave({
    data: modelData,
    save: saveModel,
  })

  // Derive key status from aiProvider config
  const keyStatus = useMemo(() => ({
    anthropic: !!aiProvider.apiKeys?.anthropic,
    openai: !!aiProvider.apiKeys?.openai,
    google: !!aiProvider.apiKeys?.google,
  }), [aiProvider.apiKeys])

  const [liveKeyStatus, setLiveKeyStatus] = useState(keyStatus)

  useEffect(() => setLiveKeyStatus(keyStatus), [keyStatus])

  useEffect(() => () => {
    if (keySavedTimer.current) clearTimeout(keySavedTimer.current)
  }, [])

  const handleProviderChange = (newUiProvider: string) => {
    setUiProvider(newUiProvider)
    setBaseUrl('')
    if (newUiProvider === 'custom') {
      setSdkProvider('openai')
      setModel('')
      setCustomModel('')
    } else {
      setSdkProvider(newUiProvider)
      const defaults = PROVIDER_MODELS[newUiProvider]
      if (defaults?.length) {
        setModel(defaults[0].value)
        setCustomModel('')
      } else {
        setModel('')
      }
    }
  }

  const handleModelSelect = (value: string) => {
    if (value === '__custom__') {
      setModel('')
      setCustomModel('')
    } else {
      setModel(value)
      setCustomModel('')
    }
  }

  const handleSaveKeys = async () => {
    setKeySaveStatus('saving')
    try {
      // Merge new keys into current aiProvider config
      const updatedKeys = { ...aiProvider.apiKeys }
      if (keys.anthropic) updatedKeys.anthropic = keys.anthropic
      if (keys.openai) updatedKeys.openai = keys.openai
      if (keys.google) updatedKeys.google = keys.google
      await api.config.updateSection('aiProvider', { ...aiProvider, apiKeys: updatedKeys })
      setLiveKeyStatus({
        anthropic: !!updatedKeys.anthropic,
        openai: !!updatedKeys.openai,
        google: !!updatedKeys.google,
      })
      setKeys({ anthropic: '', openai: '', google: '' })
      setKeySaveStatus('saved')
      if (keySavedTimer.current) clearTimeout(keySavedTimer.current)
      keySavedTimer.current = setTimeout(() => setKeySaveStatus('idle'), 2000)
    } catch {
      setKeySaveStatus('error')
    }
  }

  return (
    <>
      <Field label="Provider">
        <div className="flex border border-border rounded-lg overflow-hidden">
          {PROVIDERS.map((p, i) => (
            <button
              key={p.value}
              onClick={() => handleProviderChange(p.value)}
              className={`flex-1 py-2 px-3 text-[13px] font-medium transition-colors ${
                uiProvider === p.value
                  ? 'bg-accent-dim text-accent'
                  : 'bg-bg text-text-muted hover:bg-bg-tertiary hover:text-text'
              } ${i > 0 ? 'border-l border-border' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Custom mode: API format selector */}
      {isCustomMode && (
        <Field label="API Format">
          <select
            className={inputClass}
            value={sdkProvider}
            onChange={(e) => setSdkProvider(e.target.value)}
          >
            {SDK_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-text-muted mt-1">
            Which API protocol does your endpoint speak?
          </p>
        </Field>
      )}

      {/* Standard mode: preset model dropdown */}
      {!isCustomMode && (
        <Field label="Model">
          <select
            className={inputClass}
            value={isCustomModelInStandard || model === '' ? '__custom__' : model}
            onChange={(e) => handleModelSelect(e.target.value)}
          >
            {presets.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
            <option value="__custom__">Custom...</option>
          </select>
        </Field>
      )}

      {/* Free-text model ID — always shown in custom mode, or when "Custom..." selected in standard mode */}
      {(isCustomMode || isCustomModelInStandard || (!isCustomMode && model === '')) && (
        <Field label={isCustomMode ? 'Model ID' : 'Custom Model ID'}>
          <input
            className={inputClass}
            value={customModel || model}
            onChange={(e) => { setCustomModel(e.target.value); setModel(e.target.value) }}
            placeholder={isCustomMode ? 'e.g. gpt-4o, claude-3-opus' : 'e.g. claude-sonnet-4-5-20250929'}
          />
        </Field>
      )}

      <Field label="Base URL">
        <input
          className={inputClass}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={isCustomMode ? 'https://your-relay.example.com/v1' : 'Leave empty for official API'}
        />
        <p className="text-[11px] text-text-muted mt-1">
          {isCustomMode ? 'Your relay or proxy endpoint.' : 'Custom endpoint for proxy or relay.'}
        </p>
      </Field>

      <SaveIndicator status={modelStatus} onRetry={modelRetry} />

      {/* API Keys */}
      <div className="mt-5 border-t border-border pt-4">
        <button
          onClick={() => setShowKeys(!showKeys)}
          className="flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors"
        >
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${showKeys ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          API Keys
          <span className="text-[11px] text-text-muted/60 ml-1">
            ({Object.values(liveKeyStatus).filter(Boolean).length}/{Object.keys(liveKeyStatus).length} configured)
          </span>
        </button>

        {showKeys && (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-text-muted">
              {isCustomMode
                ? 'Enter the API key for your relay. It will be sent under the matching provider header.'
                : 'Enter API keys below. Leave empty to keep existing value.'}
            </p>
            {(isCustomMode
              ? SDK_FORMATS.filter((f) => f.value === sdkProvider)
              : PROVIDERS.filter((p) => p.value !== 'custom')
            ).map((p) => (
              <Field key={p.value} label={isCustomMode ? `API Key (${p.label})` : `${p.label} API Key`}>
                <div className="relative">
                  <input
                    className={inputClass}
                    type="password"
                    value={keys[p.value as keyof typeof keys] ?? ''}
                    onChange={(e) => setKeys((k) => ({ ...k, [p.value]: e.target.value }))}
                    placeholder={liveKeyStatus[p.value as keyof typeof liveKeyStatus] ? '(configured)' : 'Not configured'}
                  />
                  {liveKeyStatus[p.value as keyof typeof liveKeyStatus] && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-green">
                      active
                    </span>
                  )}
                </div>
              </Field>
            ))}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveKeys}
                disabled={keySaveStatus === 'saving'}
                className="btn-primary"
              >
                Save Keys
              </button>
              <SaveIndicator status={keySaveStatus} onRetry={handleSaveKeys} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ==================== Agent SDK Auth Form ====================

function AgentSdkAuthForm({ aiProvider, onUpdate }: { aiProvider: AIProviderConfig; onUpdate: (patch: Partial<AIProviderConfig>) => void }) {
  const [loginMethod, setLoginMethod] = useState<LoginMethod>(aiProvider.loginMethod ?? 'api-key')
  const [apiKey, setApiKey] = useState('')
  const [keySaveStatus, setKeySaveStatus] = useState<SaveStatus>('idle')
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  const handleLoginMethodChange = async (method: LoginMethod) => {
    setLoginMethod(method)
    try {
      await api.config.updateSection('aiProvider', { ...aiProvider, loginMethod: method })
      onUpdate({ loginMethod: method })
    } catch { /* revert on failure */ setLoginMethod(loginMethod) }
  }

  const handleSaveKey = async () => {
    if (!apiKey) return
    setKeySaveStatus('saving')
    try {
      const updatedKeys = { ...aiProvider.apiKeys, anthropic: apiKey }
      await api.config.updateSection('aiProvider', { ...aiProvider, apiKeys: updatedKeys })
      onUpdate({ apiKeys: updatedKeys })
      setApiKey('')
      setKeySaveStatus('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setKeySaveStatus('idle'), 2000)
    } catch { setKeySaveStatus('error') }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {LOGIN_METHODS.map((m) => (
          <BackendCard
            key={m.value}
            selected={loginMethod === m.value}
            onClick={() => handleLoginMethodChange(m.value)}
            icon={m.value === 'claudeai'
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}
            title={m.label}
            description={m.subtitle}
          />
        ))}
      </div>
      <p className="text-[11px] text-text-muted mt-2">
        {LOGIN_METHODS.find((m) => m.value === loginMethod)?.hint}
      </p>

      {loginMethod === 'api-key' && (
        <Field label="Anthropic API Key">
          <div className="relative">
            <input
              className={inputClass}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={aiProvider.apiKeys?.anthropic ? '(configured)' : 'sk-ant-...'}
            />
            {aiProvider.apiKeys?.anthropic && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-green">active</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleSaveKey}
              disabled={!apiKey || keySaveStatus === 'saving'}
              className="btn-primary"
            >
              Save Key
            </button>
            <SaveIndicator status={keySaveStatus} onRetry={handleSaveKey} />
          </div>
        </Field>
      )}
    </>
  )
}
