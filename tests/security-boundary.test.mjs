import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import security from "../electron/foundation/security-boundary.cjs";

const appRoot = path.resolve(process.cwd());
const appPage = name => pathToFileURL(path.join(appRoot, name)).href;

test("only bundled top-level HTML documents are trusted", () => {
  assert.equal(security.trustedAppPage(appPage("index.html"), appRoot), "index.html");
  assert.equal(security.trustedAppPage(appPage("review.html") + "?source=menu#recording", appRoot), "review.html");
  assert.equal(security.trustedAppPage(appPage("tracker-collector.html"), appRoot), "tracker-collector.html");
  assert.equal(security.trustedAppPage(appPage("preload.cjs"), appRoot), null);
  assert.equal(security.trustedAppPage(pathToFileURL(path.join(appRoot, "electron", "main.cjs")).href, appRoot), null);
  assert.equal(security.trustedAppPage(pathToFileURL(path.join(path.dirname(appRoot), "index.html")).href, appRoot), null);
  assert.equal(security.trustedAppPage("https://example.com/index.html", appRoot), null);
  assert.equal(security.trustedAppPage("file://untrusted-host/index.html", appRoot), null);
  assert.equal(security.trustedAppPage("invalid", appRoot), null);
});

test("IPC requires the exact active main frame, not only a matching webContents ID", () => {
  const mainFrame = { url: appPage("review.html") };
  const contents = { id: 42, mainFrame };
  assert.equal(security.trustedIpcSender({ sender: contents, senderFrame: mainFrame }, contents, appRoot), true);
  assert.equal(security.trustedIpcSender({ sender: contents, senderFrame: mainFrame }, contents, appRoot, "review.html"), true);
  assert.equal(security.trustedIpcSender({ sender: contents, senderFrame: mainFrame }, contents, appRoot, "tracker-collector.html"), false);
  assert.equal(security.trustedIpcSender({ sender: contents, senderFrame: { url: mainFrame.url } }, contents, appRoot), false);
  assert.equal(security.trustedIpcSender({ sender: { id: 42 }, senderFrame: mainFrame }, contents, appRoot), false);
  assert.equal(security.trustedIpcSender({ sender: contents }, contents, appRoot), false);
  assert.equal(security.trustedIpcSender({ sender: contents, senderFrame: { url: "https://example.com/" } }, contents, appRoot), false);
});

test("external links only permit HTTPS without URL credentials", () => {
  assert.equal(security.safeExternalUrl("https://github.com/EliteMay"), "https://github.com/EliteMay");
  for (const value of ["http://example.com/", "file:///etc/passwd", "javascript:alert(1)", "https://user:password@example.com/", "//example.com", "not a url"]) {
    assert.equal(security.safeExternalUrl(value), null, value);
  }
});
