const i18nApi = typeof browser !== "undefined" ? browser.i18n : chrome.i18n;

const t = (key, substitutions) => {
  const message = i18nApi.getMessage(key, substitutions);
  return message || key;
};

const applyI18n = () => {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (key) {
      element.textContent = t(key);
    }
  });

  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    const key = element.getAttribute("data-i18n-title");
    if (key) {
      element.title = t(key);
    }
  });
};

document.addEventListener("DOMContentLoaded", applyI18n);
