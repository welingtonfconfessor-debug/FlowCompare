import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a entrada PHP carrega o frontend compilado", async () => {
  const [php, manifest] = await Promise.all([
    readFile(new URL("../public/index.php", import.meta.url), "utf8"),
    readFile(new URL("../public/build/.vite/manifest.json", import.meta.url), "utf8"),
  ]);

  assert.match(php, /<title>FlowCompare \| Comparador DXF<\/title>/i);
  assert.match(php, /id="flowcompare-root"/);
  assert.match(php, /AssetManifest/);
  assert.ok(JSON.parse(manifest)["frontend/main.tsx"]);
});

test("remove o servidor Vinext e mantém o motor do FlowCompare", async () => {
  const [main, workspace, packageJson] = await Promise.all([
    readFile(new URL("../frontend/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/FlowCompareWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(main, /FlowCompareWorkspace/);
  assert.match(workspace, /parseDxfFile/);
  assert.match(packageJson, /"name": "flowcompare"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|cloudflare/i);
});
