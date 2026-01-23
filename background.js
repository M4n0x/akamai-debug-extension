const api = typeof browser !== "undefined" ? browser : chrome;
const isBrowserApi = typeof browser !== "undefined";

const actionApi = api.action || api.browserAction;
const rulesApi = api.declarativeNetRequest || null;
const useSessionRules = rulesApi && typeof rulesApi.updateSessionRules === "function";
const sessionStore = api.storage && api.storage.session ? api.storage.session : null;

const PRAGMA_VALUES = [
  "akamai-x-cache-on",
  "akamai-x-cache-remote-on",
  "akamai-x-check-cacheable",
  "akamai-x-get-cache-key",
  "akamai-x-get-true-cache-key",
  "akamai-x-get-request-id",
  "akamai-x-get-extracted-values"
];

const PRAGMA_HEADER_VALUE = PRAGMA_VALUES.join(", ");
const RULE_ID_BASE = 100000;

const debugTabs = new Map();
const tabHeaders = new Map();
const tabHistory = new Map();
const tabAlerts = new Map();
const ruleMatches = new Map();
const forceRefreshTabs = new Set();
let initPromise = null;

const MAX_HISTORY = 10;
const FORCE_REFRESH_RULE_BASE = 900000;

const getRuleId = (tabId) => RULE_ID_BASE + tabId;
const getForceRuleId = (tabId) => FORCE_REFRESH_RULE_BASE + tabId;

const getHeaderValue = (headers, key) => {
  if (!headers || !headers[key] || headers[key].length === 0) {
    return null;
  }
  return headers[key][0];
};

const parseCacheControl = (cacheControl) => {
  if (!cacheControl) {
    return { maxAge: null, sMaxage: null, noCache: false, noStore: false };
  }
  const parts = cacheControl.toLowerCase().split(',').map((part) => part.trim());
  const result = { maxAge: null, sMaxage: null, noCache: false, noStore: false };
  
  for (const part of parts) {
    if (part === 'no-cache') {
      result.noCache = true;
    } else if (part === 'no-store') {
      result.noStore = true;
    } else if (part.startsWith('max-age=')) {
      const value = parseInt(part.substring(8), 10);
      result.maxAge = Number.isNaN(value) ? null : value;
    } else if (part.startsWith('s-maxage=')) {
      const value = parseInt(part.substring(9), 10);
      result.sMaxage = Number.isNaN(value) ? null : value;
    }
  }
  return result;
};

const analyzeCache = (headers, statusCode) => {
  const xCache = getHeaderValue(headers, 'x-cache') || '';
  const xCacheRemote = getHeaderValue(headers, 'x-cache-remote') || '';
  const ageValue = parseInt(getHeaderValue(headers, 'age') || '0', 10);
  const age = Number.isNaN(ageValue) ? 0 : ageValue;
  const cacheControlHeader = getHeaderValue(headers, 'cache-control');
  const cacheControl = parseCacheControl(cacheControlHeader);

  const ttl = cacheControl.sMaxage || cacheControl.maxAge || null;
  const combined = `${xCache} ${xCacheRemote}`.toLowerCase();
  const isHit = combined.includes('hit');
  const isMiss = combined.includes('miss');
  const isBypass = combined.includes('bypass') || combined.includes('refresh') || combined.includes('pass');
  const isStale = ttl !== null && age > ttl;
  const cacheDisabled = cacheControl.noCache || cacheControl.noStore;

  return {
    status: isHit ? 'HIT' : (isMiss ? 'MISS' : (isBypass ? 'BYPASS' : 'UNKNOWN')),
    age,
    ttl,
    isStale,
    cacheDisabled,
    xCache,
    xCacheRemote
  };
};

const addToHistory = (tabId, entry) => {
  if (!tabHistory.has(tabId)) {
    tabHistory.set(tabId, []);
  }
  const history = tabHistory.get(tabId);
  history.unshift(entry);
  if (history.length > MAX_HISTORY) {
    history.pop();
  }
  
  // Detect HIT → MISS transitions
  if (history.length >= 2) {
    const current = history[0];
    const previous = history[1];
    if (current.url === previous.url && previous.analysis.status === 'HIT' && current.analysis.status === 'MISS') {
      const alerts = tabAlerts.get(tabId) || [];
      alerts.push({
        type: 'hit-to-miss',
        message: 'Cache status changed from HIT to MISS for this URL',
        timestamp: Date.now()
      });
      tabAlerts.set(tabId, alerts.slice(-5));
    }
  }
  
  // Check for cache key churn
  const cacheKeys = history.map(h => h.xCacheKey).filter(k => k);
  const uniqueKeys = new Set(cacheKeys);
  if (cacheKeys.length >= 5 && uniqueKeys.size >= 4) {
    const alerts = tabAlerts.get(tabId) || [];
    if (!alerts.some(a => a.type === 'cache-key-churn')) {
      alerts.push({
        type: 'cache-key-churn',
        message: 'High cache key variability detected - may reduce hit rate',
        timestamp: Date.now()
      });
      tabAlerts.set(tabId, alerts.slice(-5));
    }
  }
  
  // Check for stale content
  if (entry.analysis.isStale) {
    const alerts = tabAlerts.get(tabId) || [];
    alerts.push({
      type: 'stale',
      message: `Content is stale (age ${entry.analysis.age}s > max-age ${entry.analysis.ttl}s)`,
      timestamp: Date.now()
    });
    tabAlerts.set(tabId, alerts.slice(-5));
  }
  
  // Check for disabled cache
  if (entry.analysis.cacheDisabled) {
    const alerts = tabAlerts.get(tabId) || [];
    alerts.push({
      type: 'cache-disabled',
      message: 'Cache-Control indicates caching is disabled (no-cache or no-store)',
      timestamp: Date.now()
    });
    tabAlerts.set(tabId, alerts.slice(-5));
  }
};

const buildRule = (tabId, forceRefresh = false) => {
  const pragmaValue = forceRefresh ? `${PRAGMA_HEADER_VALUE}, no-cache` : PRAGMA_HEADER_VALUE;
  const requestHeaders = [
    {
      header: "Pragma",
      operation: "set",
      value: pragmaValue
    }
  ];

  if (forceRefresh) {
    requestHeaders.push({
      header: "Cache-Control",
      operation: "set",
      value: "no-cache"
    });
  }

  return {
    id: forceRefresh ? getForceRuleId(tabId) : getRuleId(tabId),
    priority: forceRefresh ? 2 : 1,
    action: {
      type: "modifyHeaders",
      requestHeaders
    },
    condition: {
      tabIds: [tabId],
      resourceTypes: ["main_frame"],
      regexFilter: "^https?://"
    }
  };
};

const normalizeHeaders = (headers = []) => {
  const normalized = {};
  for (const header of headers) {
    if (!header || !header.name) {
      continue;
    }
    const key = header.name.toLowerCase();
    if (!normalized[key]) {
      normalized[key] = [];
    }
    if (header.value) {
      normalized[key].push(header.value);
    }
  }
  return normalized;
};

const queryTabs = (query) => {
  const result = api.tabs.query(query);
  if (result && typeof result.then === "function") {
    return result;
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

const callDnr = (method, options) => {
  if (!method) {
    return Promise.resolve();
  }
  if (isBrowserApi) {
    return options === undefined ? method() : method(options);
  }
  return new Promise((resolve, reject) => {
    const callback = (result) => {
      if (api.runtime.lastError) {
        reject(api.runtime.lastError);
        return;
      }
      resolve(result);
    };
    if (options === undefined) {
      method(callback);
    } else {
      method(options, callback);
    }
  });
};

const updateRules = (options) => {
  if (!rulesApi) {
    return Promise.resolve();
  }
  const method = useSessionRules ? rulesApi.updateSessionRules.bind(rulesApi) : rulesApi.updateDynamicRules.bind(rulesApi);
  return callDnr(method, options);
};

const getRules = () => {
  if (!rulesApi) {
    return Promise.resolve([]);
  }
  const method = useSessionRules ? rulesApi.getSessionRules.bind(rulesApi) : rulesApi.getDynamicRules.bind(rulesApi);
  return callDnr(method);
};

const updateBadge = async (tabId, enabled) => {
  if (!actionApi || !actionApi.setBadgeText) {
    return;
  }

  const text = enabled ? "ON" : "";
  const color = enabled ? "#1f7a4a" : "#000000";

  await actionApi.setBadgeText({ tabId, text });
  if (actionApi.setBadgeBackgroundColor) {
    await actionApi.setBadgeBackgroundColor({ tabId, color });
  }
  if (actionApi.setBadgeTextColor) {
    await actionApi.setBadgeTextColor({ tabId, color: "#ffffff" });
  }
};

const syncBadge = async (tabId) => {
  await ensureInitialized();
  let enabled = debugTabs.get(tabId) || false;
  if (!enabled && rulesApi) {
    const rules = await getRules();
    const hasRule = rules.some((rule) => rule.id === getRuleId(tabId));
    if (hasRule) {
      debugTabs.set(tabId, true);
      enabled = true;
    }
  }
  updateBadge(tabId, enabled);
};

const persistEnabledTabs = async () => {
  if (!sessionStore) {
    return;
  }
  await sessionStore.set({ enabledTabs: Array.from(debugTabs.keys()) });
};

const readEnabledTabs = async () => {
  if (!sessionStore) {
    return [];
  }
  const data = await sessionStore.get("enabledTabs");
  return Array.isArray(data.enabledTabs) ? data.enabledTabs : [];
};

const initialize = async () => {
  if (!rulesApi) {
    return;
  }
  const storedTabs = await readEnabledTabs();
  if (!storedTabs.length) {
    return;
  }
  const tabs = await queryTabs({});
  const existingIds = new Set(tabs.map((tab) => tab.id));
  const validTabs = storedTabs.filter((tabId) => existingIds.has(tabId));
  if (!validTabs.length) {
    await persistEnabledTabs();
    return;
  }
  await updateRules({
    addRules: validTabs.map(buildRule),
    removeRuleIds: validTabs.map(getRuleId)
  });
  validTabs.forEach((tabId) => {
    debugTabs.set(tabId, true);
    updateBadge(tabId, true);
  });
  await persistEnabledTabs();
};

const ensureInitialized = () => {
  if (!initPromise) {
    initPromise = initialize();
  }
  return initPromise;
};

const toggleActiveTab = async () => {
  await ensureInitialized();
  const tabs = await queryTabs({ active: true, currentWindow: true });
  const activeTab = tabs && tabs[0] ? tabs[0] : null;
  if (!activeTab || typeof activeTab.id !== "number") {
    return;
  }
  const enabled = debugTabs.get(activeTab.id) || false;
  await setDebugEnabled(activeTab.id, !enabled);
};

const setDebugEnabled = async (tabId, enabled) => {
  await ensureInitialized();
  
  const ruleId = getRuleId(tabId);
  if (enabled) {
    if (rulesApi) {
      await updateRules({
        addRules: [buildRule(tabId)],
        removeRuleIds: [ruleId, getForceRuleId(tabId)]
      });
    }
    debugTabs.set(tabId, true);
    ruleMatches.delete(tabId);
    await persistEnabledTabs();
    await updateBadge(tabId, true);
    return true;
  }

  if (rulesApi) {
    await updateRules({
      removeRuleIds: [ruleId, getForceRuleId(tabId)]
    });
  }
  debugTabs.delete(tabId);
  tabHeaders.delete(tabId);
  ruleMatches.delete(tabId);
  await persistEnabledTabs();
  await updateBadge(tabId, false);
  return true;
};

const getTabState = async (tabId) => {
  await ensureInitialized();
  const enabled = debugTabs.get(tabId) || false;
  let ruleInstalled = false;

  if (rulesApi) {
    try {
      const rules = await getRules();
      ruleInstalled = rules.some((rule) => rule.id === getRuleId(tabId));
    } catch (e) {
      return {
        enabled,
        data: tabHeaders.get(tabId) || null,
        history: tabHistory.get(tabId) || [],
        alerts: tabAlerts.get(tabId) || [],
        ruleMatch: ruleMatches.get(tabId) || null,
        ruleInstalled: false
      };
    }
  }

  return {
    enabled,
    data: tabHeaders.get(tabId) || null,
    history: tabHistory.get(tabId) || [],
    alerts: tabAlerts.get(tabId) || [],
    ruleMatch: ruleMatches.get(tabId) || null,
    ruleInstalled
  };
};

api.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || !debugTabs.get(details.tabId)) {
      return;
    }
    tabHeaders.set(details.tabId, {
      url: details.url,
      statusCode: null,
      headers: null,
      timestamp: Date.now(),
      analysis: null,
      xCacheKey: null,
      xTrueCacheKey: null
    });
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

api.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !debugTabs.get(details.tabId)) {
      return;
    }

    const headers = normalizeHeaders(details.responseHeaders);
    const analysis = analyzeCache(headers, details.statusCode);
    
    const entry = {
      url: details.url,
      statusCode: details.statusCode,
      headers,
      timestamp: Date.now(),
      analysis,
      xCacheKey: getHeaderValue(headers, 'x-cache-key'),
      xTrueCacheKey: getHeaderValue(headers, 'x-true-cache-key')
    };
    
    tabHeaders.set(details.tabId, entry);
    addToHistory(details.tabId, entry);
    
    // Remove force refresh rule after first request
    if (forceRefreshTabs.has(details.tabId)) {
      forceRefreshTabs.delete(details.tabId);
      const removeRuleIds = [getForceRuleId(details.tabId)];
      const addRules = debugTabs.get(details.tabId) ? [buildRule(details.tabId)] : [];
      const removeBaseRule = debugTabs.get(details.tabId) ? [getRuleId(details.tabId)] : [];
      updateRules({ addRules, removeRuleIds: removeRuleIds.concat(removeBaseRule) }).catch(() => {});
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["responseHeaders"]
);

api.tabs.onRemoved.addListener((tabId) => {
  debugTabs.delete(tabId);
  tabHeaders.delete(tabId);
  tabHistory.delete(tabId);
  tabAlerts.delete(tabId);
  ruleMatches.delete(tabId);
  forceRefreshTabs.delete(tabId);
  updateBadge(tabId, false);
  persistEnabledTabs();
  updateRules({ removeRuleIds: [getRuleId(tabId), getForceRuleId(tabId)] });
});

api.tabs.onActivated.addListener((info) => {
  syncBadge(info.tabId).catch(() => {});
});

api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" && debugTabs.get(tabId)) {
    updateBadge(tabId, true);
  }
});

if (rulesApi && rulesApi.onRuleMatchedDebug) {
  rulesApi.onRuleMatchedDebug.addListener((info) => {
    if (!info || !info.request || typeof info.request.tabId !== "number") {
      return;
    }
    const tabId = info.request.tabId;
    if (tabId < 0) {
      return;
    }
    ruleMatches.set(tabId, {
      ruleId: info.rule && info.rule.ruleId ? info.rule.ruleId : null,
      url: info.request.url,
      timestamp: Date.now()
    });
  });
}

if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener((command) => {
    if (command !== "toggle-debug") {
      return;
    }
    toggleActiveTab().catch(() => {});
  });
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    sendResponse({ error: "Invalid message" });
    return false;
  }

  if (message.type === "getTabState") {
    getTabState(message.tabId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === "setTabEnabled") {
    setDebugEnabled(message.tabId, message.enabled)
      .then(() => getTabState(message.tabId))
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === "refreshTab") {
    const bypassCache = debugTabs.get(message.tabId) || false;
    api.tabs.reload(message.tabId, { bypassCache });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "forceRefresh") {
    forceRefreshTabs.add(message.tabId);
    updateRules({
      addRules: [buildRule(message.tabId, true)],
      removeRuleIds: [getForceRuleId(message.tabId), getRuleId(message.tabId)]
    })
      .then(() => {
        api.tabs.reload(message.tabId, { bypassCache: true });
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ error: error.message });
      });
    return true;
  }

  if (message.type === "exportJSON") {
    const history = tabHistory.get(message.tabId) || [];
    const alerts = tabAlerts.get(message.tabId) || [];
    const data = {
      tabId: message.tabId,
      timestamp: Date.now(),
      history,
      alerts
    };
    sendResponse({ data });
    return false;
  }

  if (message.type === "clearHistory") {
    tabHistory.set(message.tabId, []);
    tabAlerts.set(message.tabId, []);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

ensureInitialized();
