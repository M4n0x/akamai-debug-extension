const api = typeof browser !== "undefined" ? browser : chrome;
const isBrowserApi = typeof browser !== "undefined";

const EMPTY = "--";
const REFRESH_INTERVAL = 1500;

const elements = {
  pageUrl: document.getElementById("page-url"),
  tabStatus: document.getElementById("tab-status"),
  debugToggle: document.getElementById("debug-toggle"),
  injectionStatus: document.getElementById("injection-status"),
  cacheSummary: document.getElementById("cache-summary"),
  cachePill: document.getElementById("cache-pill"),
  refresh: document.getElementById("refresh"),
  forceRefresh: document.getElementById("force-refresh"),
  copy: document.getElementById("copy"),
  export: document.getElementById("export"),
  hint: document.getElementById("hint"),
  alertList: document.getElementById("alert-list"),
  historyList: document.getElementById("history-list"),
  clearHistory: document.getElementById("clear-history"),
  xCache: document.getElementById("x-cache"),
  xCacheRemote: document.getElementById("x-cache-remote"),
  xCheckCacheable: document.getElementById("x-check-cacheable"),
  age: document.getElementById("age"),
  ttl: document.getElementById("ttl"),
  ttlRemaining: document.getElementById("ttl-remaining"),
  analysisStatus: document.getElementById("analysis-status"),
  cacheDisabled: document.getElementById("cache-disabled"),
  stale: document.getElementById("stale"),
  keyDiff: document.getElementById("key-diff"),
  keyChanges: document.getElementById("key-changes"),
  xCacheKey: document.getElementById("x-cache-key"),
  xTrueCacheKey: document.getElementById("x-true-cache-key"),
  cacheControl: document.getElementById("cache-control"),
  expires: document.getElementById("expires"),
  requestId: document.getElementById("request-id"),
  server: document.getElementById("server"),
  sessionInfo: document.getElementById("session-info"),
  staging: document.getElementById("staging"),
  transformed: document.getElementById("transformed"),
  contentType: document.getElementById("content-type"),
  statusCode: document.getElementById("status-code"),
  lastUpdated: document.getElementById("last-updated")
};

const state = {
  tabId: null,
  tabUrl: null,
  enabled: false,
  data: null,
  ruleMatch: null,
  ruleInstalled: false,
  history: [],
  alerts: [],
  selectedIndex: 0
};

let refreshTimer = null;

const setPill = (element, variant, text) => {
  element.classList.remove("hit", "miss", "bypass", "neutral");
  element.classList.add(variant);
  element.textContent = text;
};

const formatUrl = (url) => {
  if (!url) {
    return "No page detected";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch (error) {
    return url;
  }
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) {
    return EMPTY;
  }
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch (error) {
    return EMPTY;
  }
};

const formatSeconds = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return EMPTY;
  }
  return `${value}s`;
};

const formatBoolean = (value) => {
  if (value === null || value === undefined) {
    return EMPTY;
  }
  return value ? "Yes" : "No";
};

const getHeaderValue = (headers, key) => {
  if (!headers || !headers[key] || headers[key].length === 0) {
    return EMPTY;
  }
  return headers[key].join(", ");
};

const deriveCacheStatus = (xCache, xCacheRemote) => {
  const combined = `${xCache} ${xCacheRemote}`.toLowerCase();
  if (combined.includes("hit")) {
    return { label: "HIT", variant: "hit" };
  }
  if (combined.includes("miss")) {
    return { label: "MISS", variant: "miss" };
  }
  if (combined.includes("bypass") || combined.includes("refresh") || combined.includes("pass")) {
    return { label: "BYPASS", variant: "bypass" };
  }
  return { label: "N/A", variant: "neutral" };
};

const buildCacheSummary = (xCache, xCacheRemote) => {
  const parts = [];
  if (xCache !== EMPTY) {
    parts.push(`Edge: ${xCache}`);
  }
  if (xCacheRemote !== EMPTY) {
    parts.push(`Parent: ${xCacheRemote}`);
  }
  return parts.length ? parts.join(" | ") : "No response yet";
};

const getSelectedEntry = () => {
  if (!state.history || state.history.length === 0) {
    return state.data;
  }
  return state.history[state.selectedIndex] || state.history[0];
};

const updateFields = (entry) => {
  const headers = entry ? entry.headers : null;
  const analysis = entry ? entry.analysis : null;

  const xCache = getHeaderValue(headers, "x-cache");
  const xCacheRemote = getHeaderValue(headers, "x-cache-remote");
  const xCheckCacheable = getHeaderValue(headers, "x-check-cacheable");
  const age = getHeaderValue(headers, "age");
  const xCacheKey = getHeaderValue(headers, "x-cache-key");
  const xTrueCacheKey = getHeaderValue(headers, "x-true-cache-key");
  const cacheControl = getHeaderValue(headers, "cache-control");
  const expires = getHeaderValue(headers, "expires");
  const requestId = getHeaderValue(headers, "x-akamai-request-id");
  const server = getHeaderValue(headers, "server");
  const sessionInfo = getHeaderValue(headers, "x-akamai-session-info");
  const staging = getHeaderValue(headers, "x-akamai-staging");
  const transformed = getHeaderValue(headers, "x-akamai-transformed");
  const contentType = getHeaderValue(headers, "content-type");
  const statusCode = entry && entry.statusCode ? String(entry.statusCode) : EMPTY;
  const ttl = analysis ? analysis.ttl : null;
  const ttlRemaining = analysis && analysis.ttl !== null
    ? Math.max(analysis.ttl - analysis.age, 0)
    : null;
  const keyDiff = entry && entry.xCacheKey && entry.xTrueCacheKey
    ? (entry.xCacheKey === entry.xTrueCacheKey ? "Match" : "Diff")
    : EMPTY;
  const keyChangesCount = state.history.length
    ? new Set(state.history.map((item) => item.xCacheKey).filter(Boolean)).size
    : 0;
  const keyChanges = state.history.length ? `${keyChangesCount}/${state.history.length}` : EMPTY;

  elements.xCache.textContent = xCache;
  elements.xCacheRemote.textContent = xCacheRemote;
  elements.xCheckCacheable.textContent = xCheckCacheable;
  elements.age.textContent = age;
  elements.ttl.textContent = formatSeconds(ttl);
  elements.ttlRemaining.textContent = formatSeconds(ttlRemaining);
  elements.analysisStatus.textContent = analysis ? analysis.status : EMPTY;
  elements.cacheDisabled.textContent = formatBoolean(analysis ? analysis.cacheDisabled : null);
  elements.stale.textContent = formatBoolean(analysis ? analysis.isStale : null);
  elements.keyDiff.textContent = keyDiff;
  elements.keyChanges.textContent = keyChanges;
  elements.xCacheKey.textContent = xCacheKey;
  elements.xTrueCacheKey.textContent = xTrueCacheKey;
  elements.cacheControl.textContent = cacheControl;
  elements.expires.textContent = expires;
  elements.requestId.textContent = requestId;
  elements.server.textContent = server;
  elements.sessionInfo.textContent = sessionInfo;
  elements.staging.textContent = staging;
  elements.transformed.textContent = transformed;
  elements.contentType.textContent = contentType;
  elements.statusCode.textContent = statusCode;
  elements.lastUpdated.textContent = formatTimestamp(entry ? entry.timestamp : null);

  const status = deriveCacheStatus(xCache, xCacheRemote);
  elements.cacheSummary.textContent = buildCacheSummary(xCache, xCacheRemote);
  setPill(elements.cachePill, status.variant, status.label);
};

const updateAlerts = () => {
  elements.alertList.innerHTML = "";
  if (!state.alerts || state.alerts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No alerts yet";
    elements.alertList.appendChild(empty);
    return;
  }

  state.alerts.slice().reverse().forEach((alert) => {
    const item = document.createElement("div");
    item.className = "alert-item";

    const tag = document.createElement("span");
    tag.className = "alert-tag";
    tag.textContent = alert.type.replace(/-/g, " ");

    const message = document.createElement("span");
    message.className = "alert-message";
    message.textContent = alert.message;

    const time = document.createElement("span");
    time.className = "alert-time";
    time.textContent = formatTimestamp(alert.timestamp);

    item.appendChild(tag);
    item.appendChild(message);
    item.appendChild(time);
    elements.alertList.appendChild(item);
  });
};

const updateHistory = () => {
  elements.historyList.innerHTML = "";
  if (!state.history || state.history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No requests captured yet";
    elements.historyList.appendChild(empty);
    return;
  }

  state.history.forEach((entry, index) => {
    const item = document.createElement("button");
    item.className = "history-item";
    if (index === state.selectedIndex) {
      item.classList.add("active");
    }
    item.dataset.index = String(index);

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = formatTimestamp(entry.timestamp);

    const status = document.createElement("span");
    const statusValue = entry.analysis ? entry.analysis.status : "UNKNOWN";
    status.className = `history-status ${statusValue.toLowerCase()}`;
    status.textContent = statusValue;

    const url = document.createElement("span");
    url.className = "history-url";
    url.textContent = formatUrl(entry.url);

    const code = document.createElement("span");
    code.className = "history-code";
    code.textContent = entry.statusCode ? String(entry.statusCode) : EMPTY;

    item.appendChild(time);
    item.appendChild(status);
    item.appendChild(url);
    item.appendChild(code);
    elements.historyList.appendChild(item);
  });
};

const updateHint = () => {
  if (!state.enabled) {
    elements.hint.textContent = "Enable debug to capture Akamai headers.";
    return;
  }
  if (!state.data || !state.data.headers) {
    elements.hint.textContent = "Reload or click Refresh to capture headers.";
    return;
  }
  elements.hint.textContent = "Headers captured for the current page.";
};

const updateView = () => {
  elements.debugToggle.checked = state.enabled;
  setPill(elements.tabStatus, state.enabled ? "hit" : "neutral", state.enabled ? "Debug On" : "Debug Off");
  if (!state.enabled) {
    elements.injectionStatus.textContent = "Header injection inactive";
  } else if (!state.ruleInstalled) {
    elements.injectionStatus.textContent = "Header injection active · rule missing";
  } else if (state.ruleMatch && state.ruleMatch.timestamp) {
    elements.injectionStatus.textContent = `Header injection active · matched ${formatTimestamp(state.ruleMatch.timestamp)}`;
  } else {
    elements.injectionStatus.textContent = "Header injection active · awaiting match";
  }
  elements.injectionStatus.classList.toggle("active", state.enabled);

  const entry = getSelectedEntry();
  const url = entry && entry.url ? entry.url : state.tabUrl;
  elements.pageUrl.textContent = formatUrl(url);
  updateFields(entry);
  updateAlerts();
  updateHistory();
  updateHint();
};

const getTabs = (query) => {
  if (isBrowserApi) {
    return api.tabs.query(query);
  }
  return new Promise((resolve, reject) => {
    api.tabs.query(query, (tabs) => {
      if (api.runtime.lastError) {
        reject(api.runtime.lastError);
        return;
      }
      resolve(tabs);
    });
  });
};

const sendMessage = (message) => {
  if (isBrowserApi) {
    return api.runtime.sendMessage(message);
  }
  return new Promise((resolve, reject) => {
    api.runtime.sendMessage(message, (response) => {
      if (api.runtime.lastError) {
        reject(api.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });
};

const refreshState = async () => {
  if (!state.tabId) {
    return;
  }
  const response = await sendMessage({ type: "getTabState", tabId: state.tabId });
  if (!response || response.error) {
    elements.hint.textContent = "Unable to read tab state.";
    return;
  }
  state.enabled = !!response.enabled;
  state.data = response.data || null;
  state.history = response.history || [];
  state.alerts = response.alerts || [];
  state.selectedIndex = Math.min(state.selectedIndex, Math.max(state.history.length - 1, 0));
  state.ruleMatch = response.ruleMatch || null;
  state.ruleInstalled = !!response.ruleInstalled;
  updateView();
};

const startPolling = () => {
  if (refreshTimer) {
    return;
  }
  refreshTimer = window.setInterval(() => {
    refreshState();
  }, REFRESH_INTERVAL);
};

const stopPolling = () => {
  if (!refreshTimer) {
    return;
  }
  window.clearInterval(refreshTimer);
  refreshTimer = null;
};

const handleToggle = async () => {
  if (!state.tabId) {
    return;
  }
  const wasEnabled = state.enabled;
  const newEnabled = elements.debugToggle.checked;
  elements.debugToggle.disabled = true;
  try {
    const response = await sendMessage({
      type: "setTabEnabled",
      tabId: state.tabId,
      enabled: newEnabled
    });
    if (response && !response.error) {
      state.enabled = !!response.enabled;
      state.data = response.data || null;
      state.history = response.history || [];
      state.alerts = response.alerts || [];
      state.selectedIndex = Math.min(state.selectedIndex, Math.max(state.history.length - 1, 0));
      state.ruleMatch = response.ruleMatch || null;
      state.ruleInstalled = !!response.ruleInstalled;
      updateView();
      if (!wasEnabled && state.enabled) {
        await handleRefresh();
      }
    } else if (response && response.error) {
      elements.debugToggle.checked = wasEnabled;
      elements.hint.textContent = response.error;
    } else {
      elements.debugToggle.checked = wasEnabled;
      elements.hint.textContent = "No response from background script";
    }
  } catch (error) {
    elements.debugToggle.checked = wasEnabled;
    elements.hint.textContent = error && error.message ? error.message : "Failed to update debug mode.";
  } finally {
    elements.debugToggle.disabled = false;
  }
};

const handleRefresh = async () => {
  if (!state.tabId) {
    return;
  }
  try {
    await sendMessage({ type: "refreshTab", tabId: state.tabId });
    elements.hint.textContent = "Refreshing tab to capture headers.";
  } catch (error) {
    elements.hint.textContent = "Failed to refresh the tab.";
  }
};

const buildCopyPayload = () => {
  const entry = getSelectedEntry();
  return {
    tabId: state.tabId,
    url: entry && entry.url ? entry.url : state.tabUrl,
    timestamp: Date.now(),
    selectedIndex: state.selectedIndex,
    entry,
    alerts: state.alerts
  };
};

const handleCopy = async () => {
  const text = JSON.stringify(buildCopyPayload(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    elements.hint.textContent = "Copied JSON to clipboard.";
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    elements.hint.textContent = "Copied JSON to clipboard.";
  }
};

const handleExport = async () => {
  if (!state.tabId) {
    return;
  }
  try {
    const response = await sendMessage({ type: "exportJSON", tabId: state.tabId });
    if (!response || response.error) {
      elements.hint.textContent = "Failed to export JSON.";
      return;
    }
    const data = response.data || {};
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `akamai-debug-${state.tabId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    elements.hint.textContent = "Exported JSON file.";
  } catch (error) {
    elements.hint.textContent = "Failed to export JSON.";
  }
};

const handleForceRefresh = async () => {
  if (!state.tabId) {
    return;
  }
  try {
    await sendMessage({ type: "forceRefresh", tabId: state.tabId });
    elements.hint.textContent = "Force refresh sent with no-cache header.";
  } catch (error) {
    elements.hint.textContent = "Failed to force refresh.";
  }
};

const handleClearHistory = async () => {
  if (!state.tabId) {
    return;
  }
  try {
    const response = await sendMessage({ type: "clearHistory", tabId: state.tabId });
    if (response && response.error) {
      elements.hint.textContent = "Failed to clear history.";
      return;
    }
    state.history = [];
    state.alerts = [];
    state.selectedIndex = 0;
    updateView();
    elements.hint.textContent = "History cleared for this tab.";
  } catch (error) {
    elements.hint.textContent = "Failed to clear history.";
  }
};

const init = async () => {
  try {
    const tabs = await getTabs({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      elements.hint.textContent = "No active tab found.";
      return;
    }
    state.tabId = tabs[0].id;
    state.tabUrl = tabs[0].url || null;
    await refreshState();
    startPolling();
  } catch (error) {
    elements.hint.textContent = "Unable to read tab information.";
  }
};

elements.debugToggle.addEventListener("change", handleToggle);
elements.historyList.addEventListener("click", (event) => {
  const target = event.target.closest(".history-item");
  if (!target) {
    return;
  }
  const index = Number(target.dataset.index);
  if (Number.isNaN(index)) {
    return;
  }
  state.selectedIndex = index;
  updateView();
});
elements.refresh.addEventListener("click", handleRefresh);
elements.forceRefresh.addEventListener("click", handleForceRefresh);
elements.copy.addEventListener("click", handleCopy);
elements.export.addEventListener("click", handleExport);
elements.clearHistory.addEventListener("click", handleClearHistory);
window.addEventListener("focus", refreshState);
window.addEventListener("beforeunload", stopPolling);

init();
