import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const publicDirectory = path.join(root, "public");
const outputDirectory = path.join(root, "dist");
const clientDirectory = path.join(outputDirectory, "client");
const serverDirectory = path.join(outputDirectory, "server");
const manifestPath = path.join(publicDirectory, "build", ".vite", "manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entry = manifest["frontend/main.tsx"];

if (!entry?.file) {
  throw new Error("A entrada frontend/main.tsx nao foi encontrada no manifesto do Vite.");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(clientDirectory, { recursive: true });
await mkdir(serverDirectory, { recursive: true });
await cp(path.join(publicDirectory, "build"), path.join(clientDirectory, "build"), {
  recursive: true,
});

for (const asset of [
  "favicon.svg",
  "flowcompare-logo.svg",
  "flowcompare-logo-dark.svg",
  "flowcompare-mark.svg",
]) {
  await cp(path.join(publicDirectory, asset), path.join(clientDirectory, asset));
}

const styles = (entry.css ?? [])
  .map((file) => `  <link rel="stylesheet" href="/build/${file}">`)
  .join("\n");

const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#070d11">
  <meta name="description" content="Compare, alinhe e inspecione diferencas reais entre dois desenhos DXF.">
  <title>FlowCompare | Comparador DXF</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
${styles}
  <script type="module" src="/build/${entry.file}"></script>
</head>
<body>
  <div id="flowcompare-root"></div>
  <noscript>Ative o JavaScript para importar e comparar arquivos DXF.</noscript>
</body>
</html>
`;

const worker = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);

    if (response.status !== 404 || request.method !== "GET") {
      return response;
    }

    const url = new URL(request.url);
    url.pathname = "/";
    url.search = "";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
`;

await writeFile(path.join(clientDirectory, "index.html"), html, "utf8");
await writeFile(path.join(serverDirectory, "index.js"), worker, "utf8");
