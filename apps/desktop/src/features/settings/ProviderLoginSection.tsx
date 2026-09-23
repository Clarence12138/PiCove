import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import type { BuiltinProviderAuthStatus, BuiltinProviderModelChoice } from "@pideck/protocol";
import { hostClient } from "../../lib/bridge/host-client";
import { hostContext } from "../../lib/bridge/host-context";
import { useAppStore } from "../../lib/stores/app-store";
import { useT } from "../../lib/i18n/use-t";
import { useImeComposition } from "../../lib/use-ime-composition";
import { BuiltinModelSelection } from "./BuiltinModelSelection";
import { Switch } from "../../components/Switch";
import { primaryButton, secondaryButton } from "../../components/Dialog";

/** Rows shown before "show all": signed-in, enabled, or subscription (OAuth) providers. */
function isFeaturedLoginProvider(provider: BuiltinProviderAuthStatus): boolean {
  return provider.configured || provider.enabled || provider.supportsOauth;
}

export function ProviderLoginPage({ onClose }: { onClose: () => void }) {
  const t = useT();
  const host = useAppStore((s) => s.host);
  const workspace = useAppStore((s) => s.workspace);
  const providerLogin = useAppStore((s) => s.providerLogin);
  const beginProviderLogin = useAppStore((s) => s.beginProviderLogin);
  const applyProviderLoginEvent = useAppStore((s) => s.applyProviderLoginEvent);
  const clearProviderLogin = useAppStore((s) => s.clearProviderLogin);
  const refreshProviderConfig = useAppStore((s) => s.refreshProviderConfig);
  const pushNotification = useAppStore((s) => s.pushNotification);

  const [providers, setProviders] = useState<BuiltinProviderAuthStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [modelPanel, setModelPanel] = useState<{
    providerId: string;
    loading: boolean;
    models: BuiltinProviderModelChoice[];
  } | null>(null);
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const currentHost = useAppStore.getState().host;
    if (!currentHost) return;
    const request = ++requestSeq.current;
    const res = await hostClient.request("provider.authStatus", hostContext(currentHost), null);
    if (request !== requestSeq.current) return;
    if (res.ok) {
      setProviders(res.result.providers);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (host && workspace?.servicesReady) void refresh();
  }, [host, workspace?.servicesReady, refresh]);

  const loginDone = providerLogin?.done;
  useEffect(() => {
    if (loginDone) void refresh();
  }, [loginDone, refresh]);

  async function startLogin(provider: BuiltinProviderAuthStatus, authType: "oauth" | "api_key") {
    const currentHost = useAppStore.getState().host;
    if (!currentHost || providerLogin) return;
    setPendingProviderId(provider.providerId);
    try {
      const res = await hostClient.request("provider.loginStart", hostContext(currentHost), {
        providerId: provider.providerId,
        authType,
      });
      if (!res.ok) {
        pushNotification(res.error?.message ?? t("notifProviderLoginFailed"), "error");
        return;
      }
      beginProviderLogin(res.result.loginId, res.result.providerId);
    } finally {
      setPendingProviderId(null);
    }
  }

  async function logout(provider: BuiltinProviderAuthStatus) {
    const currentHost = useAppStore.getState().host;
    if (!currentHost) return;
    setPendingProviderId(provider.providerId);
    try {
      const res = await hostClient.request("provider.logout", hostContext(currentHost), {
        providerId: provider.providerId,
      });
      if (!res.ok) {
        pushNotification(res.error?.message ?? t("notifProviderLogoutFailed"), "error");
        return;
      }
      pushNotification(t("notifProviderLoggedOut", { name: provider.name }), "success");
      refreshProviderConfig();
      await refresh();
    } finally {
      setPendingProviderId(null);
    }
  }

  async function toggleEnabled(provider: BuiltinProviderAuthStatus, enabled: boolean) {
    const currentHost = useAppStore.getState().host;
    if (!currentHost) return;
    setPendingProviderId(provider.providerId);
    try {
      const res = await hostClient.request("provider.setEnabled", hostContext(currentHost), {
        providerId: provider.providerId,
        enabled,
      });
      if (!res.ok) {
        pushNotification(res.error?.message ?? t("notifProviderToggleFailed"), "error");
        return;
      }
      refreshProviderConfig();
      await refresh();
    } finally {
      setPendingProviderId(null);
    }
  }

  async function loadModelPanel(providerId: string) {
    const currentHost = useAppStore.getState().host;
    if (!currentHost) return;
    setModelPanel({ providerId, loading: true, models: [] });
    const res = await hostClient.request("provider.builtinModels", hostContext(currentHost), {
      providerId,
    });
    setModelPanel((current) => {
      if (current?.providerId !== providerId) return current;
      if (!res.ok) return null;
      return { ...current, loading: false, models: res.result.models };
    });
    if (!res.ok) {
      pushNotification(res.error?.message ?? t("notifProviderModelsFailed"), "error");
    }
  }

  async function saveModelSelection(providerId: string, models: BuiltinProviderModelChoice[]) {
    const currentHost = useAppStore.getState().host;
    if (!currentHost) {
      pushNotification(t("notifProviderModelsFailed"), "error");
      return null;
    }
    try {
      const res = await hostClient.request("provider.setBuiltinModels", hostContext(currentHost), {
        providerId,
        modelIds: models.filter((model) => model.enabled).map((model) => model.id),
      });
      if (!res.ok) {
        pushNotification(res.error?.message ?? t("notifProviderModelsFailed"), "error");
        return null;
      }
      refreshProviderConfig();
      return res.result.models;
    } catch (error) {
      pushNotification(error instanceof Error ? error.message : String(error), "error");
      return null;
    }
  }

  const visible = showAll ? providers : providers.filter(isFeaturedLoginProvider);
  const hiddenCount = providers.length - providers.filter(isFeaturedLoginProvider).length;
  const flowProvider = providerLogin
    ? providers.find((provider) => provider.providerId === providerLogin.providerId)
    : undefined;

  return (
    <div className="min-w-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{t("providersLoginSection")}</h1>
            <p className="mt-1 text-xs text-muted">{t("providersLoginPageSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-surface-overlay"
              title={t("providersLoginRefresh")}
              aria-label={t("providersLoginRefresh")}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-surface-overlay"
              title={t("commonClose")}
              aria-label={t("commonClose")}
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {providerLogin && (
          <LoginFlowCard
            state={providerLogin}
            providerName={
              flowProvider?.oauthLabel ?? flowProvider?.name ?? providerLogin.providerId
            }
            onResolvePrompt={(promptId) =>
              // Synthetic cancel keeps the store shape without a dedicated action:
              // the host has consumed the prompt once respond succeeds.
              applyProviderLoginEvent({
                loginId: providerLogin.loginId,
                providerId: providerLogin.providerId,
                event: { kind: "prompt_cancel", promptId },
              })
            }
            onClose={() => {
              clearProviderLogin();
              refreshProviderConfig();
              void refresh();
            }}
          />
        )}

        <section className="rounded-lg border border-border">
          {!loaded ? (
            <p className="p-4 text-center text-xs text-muted">{t("providersLoading")}</p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted">{t("providersNone")}</p>
          ) : (
            visible.map((provider) => {
              const busy = pendingProviderId === provider.providerId;
              const loggingIn =
                providerLogin?.providerId === provider.providerId && !providerLogin.done;
              const panelOpen = modelPanel?.providerId === provider.providerId;
              return (
                <div key={provider.providerId} className="border-b border-border last:border-b-0">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        provider.configured ? "bg-success" : "bg-muted/50"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {provider.oauthLabel ?? provider.name}
                      </span>
                      <span className="block truncate text-[11px] text-muted">
                        {loggingIn
                          ? t("providersLoginInProgress")
                          : provider.configured
                            ? (provider.authLabel ?? t("providersLoginConfigured"))
                            : t("providersLoginNotConfigured")}
                      </span>
                    </span>
                    {busy ? (
                      <Loader2 className="animate-spin text-muted" size={14} />
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5">
                        {provider.supportsOauth && (
                          <button
                            type="button"
                            className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] hover:bg-surface-overlay disabled:opacity-40"
                            disabled={Boolean(providerLogin)}
                            onClick={() => void startLogin(provider, "oauth")}
                          >
                            <LogIn size={12} />
                            {t("providersLoginOauth")}
                          </button>
                        )}
                        {provider.supportsApiKeyLogin && (
                          <button
                            type="button"
                            className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] hover:bg-surface-overlay disabled:opacity-40"
                            disabled={Boolean(providerLogin)}
                            onClick={() => void startLogin(provider, "api_key")}
                          >
                            <KeyRound size={12} />
                            {t("providersLoginApiKey")}
                          </button>
                        )}
                        {provider.hasStoredCredential && (
                          <button
                            type="button"
                            title={t("providersLogout")}
                            aria-label={`${t("providersLogout")} ${provider.name}`}
                            className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-overlay hover:text-danger disabled:opacity-40"
                            disabled={Boolean(providerLogin)}
                            onClick={() => void logout(provider)}
                          >
                            <LogOut size={13} />
                          </button>
                        )}
                        {(provider.configured || provider.enabled) && (
                          <button
                            type="button"
                            title={t("providersLoginModels")}
                            aria-label={`${t("providersLoginModels")} ${provider.name}`}
                            aria-expanded={panelOpen}
                            className={`flex size-7 items-center justify-center rounded-md ${
                              panelOpen
                                ? "bg-accent/15 text-accent"
                                : "text-muted hover:bg-surface-overlay hover:text-foreground"
                            }`}
                            onClick={() => {
                              if (panelOpen) setModelPanel(null);
                              else void loadModelPanel(provider.providerId);
                            }}
                          >
                            <SlidersHorizontal size={13} />
                          </button>
                        )}
                        <Switch
                          checked={provider.enabled}
                          label={`${provider.enabled ? "Disable" : "Enable"} ${provider.name}`}
                          disabled={
                            Boolean(providerLogin) || (!provider.configured && !provider.enabled)
                          }
                          onChange={(next) => void toggleEnabled(provider, next)}
                        />
                      </span>
                    )}
                  </div>
                  {panelOpen && modelPanel && (
                    <div className="border-t border-border bg-surface-raised/60 p-3">
                      {modelPanel.loading ? (
                        <p className="flex items-center gap-2 text-xs text-muted">
                          <Loader2 className="animate-spin" size={13} />
                          {t("providersLoading")}
                        </p>
                      ) : modelPanel.models.length === 0 ? (
                        <p className="text-xs text-muted">{t("providersLoginModelsEmpty")}</p>
                      ) : (
                        <BuiltinModelSelection
                          models={modelPanel.models}
                          providerEnabled={provider.enabled}
                          onSave={(next) => saveModelSelection(provider.providerId, next)}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="w-fit text-xs text-muted hover:text-foreground hover:underline"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? t("providersLoginShowFewer")
              : t("providersLoginShowAll", { count: hiddenCount })}
          </button>
        )}
      </div>
    </div>
  );
}

function LoginFlowCard({
  state,
  providerName,
  onResolvePrompt,
  onClose,
}: {
  state: NonNullable<ReturnType<typeof useAppStore.getState>["providerLogin"]>;
  providerName: string;
  onResolvePrompt: (promptId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const pushNotification = useAppStore((s) => s.pushNotification);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const ime = useImeComposition();
  const prompt = state.prompt;

  useEffect(() => {
    setInput("");
    setSubmitting(false);
  }, [prompt?.promptId]);

  async function submitPromptValue(value: string) {
    const currentHost = useAppStore.getState().host;
    if (!currentHost || !prompt || submitting) return;
    setSubmitting(true);
    try {
      const res = await hostClient.request("provider.loginRespond", hostContext(currentHost), {
        loginId: state.loginId,
        promptId: prompt.promptId,
        value,
      });
      if (!res.ok) {
        pushNotification(res.error?.message ?? t("notifProviderLoginFailed"), "error");
        return;
      }
      onResolvePrompt(prompt.promptId);
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelLogin() {
    const currentHost = useAppStore.getState().host;
    if (currentHost && !state.done) {
      await hostClient.request("provider.loginCancel", hostContext(currentHost), {
        loginId: state.loginId,
      });
    }
    onClose();
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the URL stays visible for manual copy */
    }
  }

  const openUrl = (url: string) => {
    void openExternalUrl(url).catch(() => {
      pushNotification(t("notifOpenUrlFailed"), "error");
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-surface-raised p-4">
      <h2 className="text-sm font-semibold">
        {t("providersLoginDialogTitle", { name: providerName })}
      </h2>

      {state.infos.map((info, index) => (
        <div key={index} className="text-xs text-muted">
          <p className="whitespace-pre-wrap">{info.message}</p>
          {info.links?.map((link) => (
            <button
              key={link.url}
              type="button"
              className="mt-1 flex items-center gap-1 text-accent hover:underline"
              onClick={() => openUrl(link.url)}
            >
              <ExternalLink size={11} />
              {link.label ?? link.url}
            </button>
          ))}
        </div>
      ))}

      {state.authUrl && (
        <div className="rounded-md border border-border bg-surface p-3">
          {state.authUrl.instructions && (
            <p className="mb-2 whitespace-pre-wrap text-xs text-muted">
              {state.authUrl.instructions}
            </p>
          )}
          <button
            type="button"
            className="mb-2 block w-full break-all text-left font-mono text-[11px] text-accent underline underline-offset-2 hover:opacity-80"
            title={t("providersLoginOpenBrowser")}
            onClick={() => openUrl(state.authUrl!.url)}
          >
            {state.authUrl.url}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryButton}
              onClick={() => openUrl(state.authUrl!.url)}
            >
              <ExternalLink size={13} />
              {t("providersLoginOpenBrowser")}
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => void copyUrl(state.authUrl!.url)}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t("providersLoginCopied") : t("providersLoginCopy")}
            </button>
          </div>
        </div>
      )}

      {state.deviceCode && (
        <div className="rounded-md border border-border bg-surface p-3 text-center">
          <p className="text-xs text-muted">{t("providersLoginDeviceCode")}</p>
          <p className="my-2 font-mono text-xl font-semibold tracking-widest">
            {state.deviceCode.userCode}
          </p>
          <button
            type="button"
            className="mx-auto mb-2 block w-full break-all text-center font-mono text-[11px] text-accent underline underline-offset-2 hover:opacity-80"
            title={t("providersLoginOpenBrowser")}
            onClick={() => openUrl(state.deviceCode!.verificationUri)}
          >
            {state.deviceCode.verificationUri}
          </button>
          <button
            type="button"
            className={`${primaryButton} mx-auto`}
            onClick={() => openUrl(state.deviceCode!.verificationUri)}
          >
            <ExternalLink size={13} />
            {t("providersLoginOpenBrowser")}
          </button>
        </div>
      )}

      {prompt && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitPromptValue(input);
          }}
        >
          <label className="text-xs text-muted" htmlFor="provider-login-input">
            {prompt.message}
          </label>
          {prompt.kind === "select" ? (
            <div className="flex flex-col gap-1">
              {(prompt.options ?? []).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="rounded-md border border-border px-3 py-2 text-left text-xs hover:border-accent hover:bg-surface-overlay"
                  disabled={submitting}
                  onClick={() => void submitPromptValue(option.id)}
                >
                  <span className="block font-medium text-foreground">{option.label}</span>
                  {option.description && (
                    <span className="block text-[11px] text-muted">{option.description}</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                id="provider-login-input"
                autoFocus
                type={prompt.kind === "secret" ? "password" : "text"}
                placeholder={prompt.placeholder}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onCompositionStart={ime.onCompositionStart}
                onCompositionEnd={ime.onCompositionEnd}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && ime.isImeKey(event)) {
                    event.preventDefault();
                  }
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 font-mono text-xs outline-none focus:border-focus"
              />
              <button
                type="submit"
                className={primaryButton}
                disabled={submitting || !input.trim()}
              >
                {t("providersLoginSubmit")}
              </button>
            </div>
          )}
        </form>
      )}

      {!state.done && (state.progress || (!prompt && !state.authUrl && !state.deviceCode)) && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="animate-spin" size={13} />
          {state.progress ?? t("providersLoginWaiting")}
        </p>
      )}

      {state.done && (
        <p className={`text-sm ${state.done.ok ? "text-success" : "text-danger"}`}>
          {state.done.ok ? t("providersLoginDone") : t("providersLoginFailed")}
          {state.done.message ? `: ${state.done.message}` : ""}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {state.done ? (
          <button type="button" className={primaryButton} onClick={onClose}>
            {t("commonClose")}
          </button>
        ) : (
          <button type="button" className={secondaryButton} onClick={() => void cancelLogin()}>
            {t("commonCancel")}
          </button>
        )}
      </div>
    </section>
  );
}
