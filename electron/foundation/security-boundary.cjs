"use strict";

const path = require("node:path");
const { fileURLToPath } = require("node:url");

// Only the application's own top-level HTML documents can access OS-facing IPC.
const APP_PAGES = new Set([
  "index.html", "review.html", "history.html", "result.html",
  "settings.html", "training.html", "diagnostics.html",
  "detector-test.html", "tracker-collector.html"
]);

function trustedAppPage(candidate, appRoot) {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "file:" || parsed.host) return null;
    const file = fileURLToPath(parsed);
    if (path.dirname(file) !== path.resolve(appRoot)) return null;
    const page = path.basename(file);
    return APP_PAGES.has(page) ? page : null;
  } catch {
    return null;
  }
}

function trustedIpcSender(event, contents, appRoot, expectedPage = null) {
  if (!event || !contents || event.sender !== contents) return false;
  if (!event.senderFrame || event.senderFrame !== contents.mainFrame) return false;
  const page = trustedAppPage(event.senderFrame.url, appRoot);
  return Boolean(page && (!expectedPage || page === expectedPage));
}

function safeExternalUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

module.exports = { trustedAppPage, trustedIpcSender, safeExternalUrl };
