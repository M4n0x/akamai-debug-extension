const api = typeof browser !== "undefined" ? browser : chrome;
const isBrowserApi = typeof browser !== "undefined";

const EMPTY = "--";

const elements = {
  pageUrl: document.getElementById("page-url"),
  tabStatus: document.getElementById("tab-status"),
  debugToggle: document.getElementById("debug-toggle"),
  injectionStatus: document.getElementById("injection-status"),
  cacheSummary: document.getElementById("cache-summary"),
  cachePill: document.getElementById("cache-pill"),
  refresh: document.getElementById("refresh"),
  copy: document.getElementById("copy"),
  hint: document.getElementById("hint"),
  xCache: document.getElementById("x-cache"),
  xCacheRemote: document.getElementById("x-cache-remote"),
  xCheckCacheable: document.getElementById("x-check-cacheable"),
  age: document.getElementById("age"),
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
  ruleInstalled: false
};

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

const updateFields = (data) => {
  const headers = data ? data.headers : null;

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
  const statusCode = data && data.statusCode ? String(data.statusCode) : EMPTY;

  elements.xCache.textContent = xCache;
  elements.xCacheRemote.textContent = xCacheRemote;
  elements.xCheckCacheable.textContent = xCheckCacheable;
  elements.age.textContent = age;
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
  elements.lastUpdated.textContent = formatTimestamp(data ? data.timestamp : null);

  const status = deriveCacheStatus(xCache, xCacheRemote);
  elements.cacheSummary.textContent = buildCacheSummary(xCache, xCacheRemote);
  setPill(elements.cachePill, status.variant, status.label);
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

  const url = state.data && state.data.url ? state.data.url : state.tabUrl;
  elements.pageUrl.textContent = formatUrl(url);
  updateFields(state.data);
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
  state.ruleMatch = response.ruleMatch || null;
  state.ruleInstalled = !!response.ruleInstalled;
  updateView();
};

const handleToggle = async () => {
  if (!state.tabId) {
    return;
  }
  const wasEnabled = state.enabled;
  elements.debugToggle.disabled = true;
  try {
    const response = await sendMessage({
      type: "setTabEnabled",
      tabId: state.tabId,
      enabled: elements.debugToggle.checked
    });
    if (response && !response.error) {
      state.enabled = !!response.enabled;
      state.data = response.data || null;
      state.ruleMatch = response.ruleMatch || null;
      state.ruleInstalled = !!response.ruleInstalled;
      updateView();
      if (!wasEnabled && state.enabled) {
        await handleRefresh();
      }
    }
  } catch (error) {
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

const buildCopyText = () => {
  const headers = state.data ? state.data.headers : null;
  const lines = [
    `URL: ${state.data && state.data.url ? state.data.url : state.tabUrl || EMPTY}`,
    `Debug Enabled: ${state.enabled ? "yes" : "no"}`,
    `Status Code: ${state.data && state.data.statusCode ? state.data.statusCode : EMPTY}`,
    "",
    "Cache Details:",
    `X-Cache: ${getHeaderValue(headers, "x-cache")}`,
    `X-Cache-Remote: ${getHeaderValue(headers, "x-cache-remote")}`,
    `X-Check-Cacheable: ${getHeaderValue(headers, "x-check-cacheable")}`,
    `Age: ${getHeaderValue(headers, "age")}`,
    `Cache-Control: ${getHeaderValue(headers, "cache-control")}`,
    `Expires: ${getHeaderValue(headers, "expires")}`,
    "",
    "Cache Keys:",
    `X-Cache-Key: ${getHeaderValue(headers, "x-cache-key")}`,
    `X-True-Cache-Key: ${getHeaderValue(headers, "x-true-cache-key")}`,
    "",
    "Request Info:",
    `Request ID: ${getHeaderValue(headers, "x-akamai-request-id")}`,
    `Server: ${getHeaderValue(headers, "server")}`,
    `X-Akamai-Session-Info: ${getHeaderValue(headers, "x-akamai-session-info")}`,
    `X-Akamai-Staging: ${getHeaderValue(headers, "x-akamai-staging")}`,
    "",
    "Transformations:",
    `X-Akamai-Transformed: ${getHeaderValue(headers, "x-akamai-transformed")}`,
    `Content-Type: ${getHeaderValue(headers, "content-type")}`
  ];
  return lines.join("\n");
};

const handleCopy = async () => {
  const text = buildCopyText();
  try {
    await navigator.clipboard.writeText(text);
    elements.hint.textContent = "Copied header details to clipboard.";
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
    elements.hint.textContent = "Copied header details to clipboard.";
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
  } catch (error) {
    elements.hint.textContent = "Unable to read tab information.";
  }
};

elements.debugToggle.addEventListener("change", handleToggle);
elements.refresh.addEventListener("click", handleRefresh);
elements.copy.addEventListener("click", handleCopy);

init();
