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

const RULE_ID_BASE = 100000;

const debugTabs = new Map();
const tabHeaders = new Map();
const ruleMatches = new Map();
let initPromise = null;

const getRuleId = (tabId) => RULE_ID_BASE + tabId;

const buildRule = (tabId) => ({
  id: getRuleId(tabId),
  priority: 1,
  action: {
    type: "modifyHeaders",
    requestHeaders: PRAGMA_VALUES.map((value) => ({
      header: "Pragma",
      operation: "append",
      value
    }))
  },
  condition: {
    tabIds: [tabId],
    resourceTypes: ["main_frame"],
    regexFilter: "^https?://"
  }
});

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

const updateBadge = (tabId, enabled) => {
  if (!actionApi || !actionApi.setBadgeText) {
    return;
  }
  const text = enabled ? "DBG" : "";
  actionApi.setBadgeText({ tabId, text });
  if (enabled && actionApi.setBadgeBackgroundColor) {
    actionApi.setBadgeBackgroundColor({ tabId, color: "#1f7a4a" });
  }
  if (enabled && actionApi.setBadgeTextColor) {
    actionApi.setBadgeTextColor({ tabId, color: "#ffffff" });
  }
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
  if (!rulesApi) {
    return;
  }

  const ruleId = getRuleId(tabId);
  if (enabled) {
    await updateRules({
      addRules: [buildRule(tabId)],
      removeRuleIds: [ruleId]
    });
    debugTabs.set(tabId, true);
    updateBadge(tabId, true);
    ruleMatches.delete(tabId);
    await persistEnabledTabs();
    return;
  }

  await updateRules({
    removeRuleIds: [ruleId]
  });
  debugTabs.delete(tabId);
  tabHeaders.delete(tabId);
  ruleMatches.delete(tabId);
  updateBadge(tabId, false);
  await persistEnabledTabs();
};

const getTabState = async (tabId) => {
  await ensureInitialized();
  const enabled = debugTabs.get(tabId) || false;
  let ruleInstalled = false;

  if (rulesApi) {
    const rules = await getRules();
    ruleInstalled = rules.some((rule) => rule.id === getRuleId(tabId));
    if (enabled && !ruleInstalled) {
      await updateRules({
        addRules: [buildRule(tabId)],
        removeRuleIds: [getRuleId(tabId)]
      });
      const refreshed = await getRules();
      ruleInstalled = refreshed.some((rule) => rule.id === getRuleId(tabId));
    }
  }

  return {
    enabled,
    data: tabHeaders.get(tabId) || null,
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
      timestamp: Date.now()
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
    tabHeaders.set(details.tabId, {
      url: details.url,
      statusCode: details.statusCode,
      headers,
      timestamp: Date.now()
    });
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["responseHeaders"]
);

api.tabs.onRemoved.addListener((tabId) => {
  debugTabs.delete(tabId);
  tabHeaders.delete(tabId);
  ruleMatches.delete(tabId);
  updateBadge(tabId, false);
  persistEnabledTabs();
  updateRules({ removeRuleIds: [getRuleId(tabId)] });
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
    return false;
  }

  if (message.type === "getTabState") {
    getTabState(message.tabId)
      .then((state) => sendResponse(state))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === "setTabEnabled") {
    ensureInitialized()
      .then(() => setDebugEnabled(message.tabId, message.enabled))
      .then(() => getTabState(message.tabId))
      .then((state) => sendResponse(state))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === "refreshTab") {
    const bypassCache = debugTabs.get(message.tabId) || false;
    api.tabs.reload(message.tabId, { bypassCache });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

ensureInitialized();
