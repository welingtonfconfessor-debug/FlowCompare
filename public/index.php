<?php

declare(strict_types=1);

use FlowCompare\AssetManifest;

$projectRoot = dirname(__DIR__);
require_once $projectRoot . '/php/AssetManifest.php';

$viteDevServer = rtrim((string) getenv('FLOWCOMPARE_VITE_DEV_SERVER'), '/');
$entry = null;
$loadError = null;

if ($viteDevServer === '') {
    try {
        $manifest = new AssetManifest(
            __DIR__ . '/build/.vite/manifest.json',
            '/build/',
        );
        $entry = $manifest->entry('frontend/main.tsx');
    } catch (RuntimeException $error) {
        http_response_code(503);
        $loadError = $error->getMessage();
    }
}

function escape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
?>
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#070d11">
  <meta name="description" content="Compare, alinhe e inspecione diferencas reais entre dois desenhos DXF.">
  <title>FlowCompare | Comparador DXF</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
<?php if ($viteDevServer !== ''): ?>
  <script type="module" src="<?= escape($viteDevServer) ?>/@vite/client"></script>
  <script type="module" src="<?= escape($viteDevServer) ?>/frontend/main.tsx"></script>
<?php elseif ($entry !== null): ?>
<?php foreach ($entry['styles'] as $stylesheet): ?>
  <link rel="stylesheet" href="<?= escape($stylesheet) ?>">
<?php endforeach; ?>
  <script type="module" src="<?= escape($entry['script']) ?>"></script>
<?php endif; ?>
</head>
<body>
<?php if ($loadError !== null): ?>
  <main class="php-startup-error">
    <img src="/flowcompare-logo-dark.svg" alt="FlowCompare">
    <h1>Frontend ainda nao compilado</h1>
    <p><?= escape($loadError) ?></p>
    <code>pnpm install &amp;&amp; pnpm build</code>
  </main>
<?php else: ?>
  <div id="flowcompare-root"></div>
  <noscript>Ative o JavaScript para importar e comparar arquivos DXF.</noscript>
<?php endif; ?>
</body>
</html>
