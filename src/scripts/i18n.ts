/**
 * Lightweight i18n loader.
 * Imports locale JSON directly and provides a `t(key)` function for translated strings.
 * Also injects `title`/`aria-label` into elements with `data-i18n` attributes.
 */

import enLocale from "../locales/en.json";
import zhLocale from "../locales/zh.json";

type LocaleData = Record<string, unknown>;

const locales: Record<string, LocaleData> = {
  en: enLocale as LocaleData,
  zh: zhLocale as LocaleData,
};

let currentLocale: LocaleData = {};

/** Get the translated string for a dot-separated key, or the key itself if not found. */
export function t(key: string): string {
  const parts = key.split(".");
  let value: unknown = currentLocale;
  for (const part of parts) {
    if (typeof value !== "object" || value === null) return key;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "string" ? value : key;
}

/** Inject translated title/aria-label into elements with data-i18n attributes. */
export function injectI18n(root: Document | Element = document) {
  const els = root.querySelectorAll("[data-i18n]");
  for (const el of els) {
    const key = (el as HTMLElement).dataset.i18n!;
    const translated = t(key);
    if (el.hasAttribute("title")) {
      el.setAttribute("title", translated);
    }
    if (el.hasAttribute("aria-label")) {
      el.setAttribute("aria-label", translated);
    }
  }
}

/** Set the active locale and inject translations into the page. */
export function loadLocale(lang: string = "en"): void {
  currentLocale = locales[lang] || locales["en"];
  injectI18n();
}
