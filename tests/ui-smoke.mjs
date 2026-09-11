import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "tmp");
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["tests/ui/entry.tsx"],
  outfile: "tmp/ui-preview.js",
  bundle: true,
  format: "iife",
  globalName: "TurnPreview",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"', __DEV__: "true" },
  alias: {
    "react-native": "react-native-web",
    "@getpaseo/plugin/client/react-native": "./tests/ui/host.tsx",
    "@getpaseo/plugin/client/ui": "./tests/ui/host.tsx",
  },
});
const script = await readFile(path.join(output, "ui-preview.js"), "utf8");
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>每轮改动 · 交互预览</title><style>body{margin:0}button,select,input{font:inherit;padding:7px 10px;border:1px solid #888;border-radius:6px}button{cursor:pointer}h3{margin:0}</style><div id="root"></div><script>${script.replace(/<\/script/gi, "<\\/script")}</script></html>`;
await writeFile(path.join(output, "preview.html"), html);
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
dom.window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
});
dom.window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
dom.window.eval(`${script}\nwindow.TurnPreview = TurnPreview;`);
const document = dom.window.document;
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`UI assertion timed out: ${document.body.textContent}`);
}
function click(label) {
  const button = [...document.querySelectorAll('button,[role="button"]')].find(
    (element) => element.getAttribute("aria-label") === label || element.textContent === label,
  );
  assert.ok(button, `missing button: ${label}`);
  button.click();
}
try {
  await until(() => document.body.textContent.includes("已编辑 2 个文件"));
  assert.ok(document.body.textContent.includes("+2"));
  assert.ok(document.body.textContent.includes("−2"));
  click("审核");
  await until(() => document.body.textContent.includes("const source = 'native';"));
  assert.deepEqual(JSON.parse(JSON.stringify(dom.window.TurnPreview.openedPanels[0])), {
    id: "review",
    workspaceId: "preview-workspace",
    agentId: "preview-agent",
    location: "explorer",
  });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(document.querySelector('[aria-label="原行号 1"]'));
  assert.ok(document.querySelector('[aria-label="新行号 1"]'));
  click("下一个文件");
  await until(() => document.body.textContent.includes("按轮次展示文件差异"));
  click("关闭审核面板");
  await until(() => !document.querySelector("aside"));
  click("查看 src/agent/change-tracker.ts 的本轮差异");
  await until(() => document.body.textContent.includes("const source = 'native';"));
  click("关闭审核面板");
  await until(() => !document.querySelector("aside"));
  dom.window.TurnPreview.fixture.state.failUndo = true;
  click("撤销");
  await until(() => document.body.textContent.includes("确认撤销"));
  click("确认撤销");
  await until(() => document.body.textContent.includes("文件已有后续修改"));
  dom.window.TurnPreview.fixture.state.failUndo = false;
  click("确认撤销");
  await until(
    () =>
      !document.querySelector('[role="dialog"]') && document.body.textContent.includes("已撤销"),
  );
  click("手机宽度");
  click("浅色");
  await until(() => document.body.textContent.includes("桌面宽度"));
  click("审核");
  await until(
    () =>
      document.querySelector('[role="dialog"]') &&
      document.body.textContent.includes("const source = 'native';"),
  );
  click("关闭弹窗");
  await until(() => !document.querySelector('[role="dialog"]'));
  click("数据来源设置");
  await until(() => document.querySelector('select[aria-label="codex"]'));
  assert.equal(document.querySelector('select[aria-label="codex"]').value, "auto");
  assert.equal(document.querySelector('select[aria-label="其他执行后端"]').value, "edits");
  await until(() => document.body.textContent.includes("无原生接口信号，自动使用插件汇总"));
  const select = document.querySelector('select[aria-label="codex"]');
  select.value = "edits";
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await until(() => document.body.textContent.includes("设置已保存"));
  assert.equal(dom.window.TurnPreview.fixture.settings().values.providers.codex, "edits");
  click("移除 codex 单独配置");
  await until(() => !document.querySelector('select[aria-label="codex"]'));
  assert.equal(
    Object.hasOwn(dom.window.TurnPreview.fixture.settings().values.providers, "codex"),
    false,
  );
  const evidence = {
    runtime: "jsdom + React Native Web; simulated host controls and RPC data",
    assertions: [
      "file totals",
      "review file navigation",
      "review opens native explorer location with correct workspace and agent",
      "file click updates the existing review selection",
      "original and updated line numbers",
      "undo conflict message",
      "undo success",
      "compact/light render",
      "compact review opens visible modal",
      "provider settings persisted through RPC",
      "native source availability",
      "remove provider override",
    ],
    realBrowserVerified: false,
  };
  await writeFile(path.join(output, "ui-smoke.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  dom.window.TurnPreview.dispose();
  dom.window.close();
}
