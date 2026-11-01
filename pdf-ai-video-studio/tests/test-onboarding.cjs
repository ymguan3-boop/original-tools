// Static first-run wiring smoke tests (no external services required).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
const python = fs.readFileSync(path.join(root, "local-service/server.py"), "utf8");
const go = fs.readFileSync(path.join(root, "desktop/launcher.go"), "utf8");
const guide = fs.readFileSync(path.join(root, "desktop/setup-guide.html"), "utf8");
for (const id of [
  "setupOverlay", "setupOpen", "setupClose", "setupContinue", "setupRefresh",
  "setupSummary", "setupBasicStatus", "setupAdvancedStatus",
  "setupProvider", "setupBase", "setupModel", "setupKey", "setupSaveLLM", "setupTestLLM",
  "setupTestVoice", "setupVoiceStatus", "setupLLMStatus"
]) {
  assert.match(html, new RegExp('id="' + id + '"'), "Missing wizard ID " + id);
  if (id !== "setupOverlay") {
    assert.ok(js.includes('$("' + id + '")'), "Missing JS wiring for " + id);
  }
}
assert.match(js, /showSetup\(\);/);
assert.match(js, /"\/api\/setup\/llm-config"/);
assert.match(js, /"\/api\/setup\/llm-test"/);
assert.match(js, /"\/api\/tts"/);
assert.match(python, /def save_llm_config/);
assert.match(python, /def test_llm_config/);
assert.match(go, /openOfflineGuide\(base\)/);
assert.match(guide, /python\.org\/downloads\/windows/);
assert.match(guide, /comfy\.org\/download/);
assert.doesNotMatch(html, /type="text"[^>]*id="setupKey"/);
console.log("PDF AI Video Studio onboarding: UI IDs, local endpoints, setup links OK");
