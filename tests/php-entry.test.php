<?php

declare(strict_types=1);

use FlowCompare\AssetManifest;

$root = dirname(__DIR__);
require_once $root . '/php/AssetManifest.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$manifest = new AssetManifest(
    $root . '/public/build/.vite/manifest.json',
    '/build/',
);
$entry = $manifest->entry('frontend/main.tsx');
expect(str_starts_with($entry['script'], '/build/assets/'), 'Script compilado nao encontrado.');
expect(count($entry['styles']) === 1, 'O CSS principal nao foi registrado no manifesto.');

ob_start();
require $root . '/public/index.php';
$html = (string) ob_get_clean();

expect(str_contains($html, '<html lang="pt-BR">'), 'Idioma da pagina PHP incorreto.');
expect(str_contains($html, '<div id="flowcompare-root"></div>'), 'Ponto de montagem ausente.');
expect(str_contains($html, $entry['script']), 'O PHP nao carregou o script compilado.');
expect(str_contains($html, $entry['styles'][0]), 'O PHP nao carregou o CSS compilado.');

echo "PHP entrypoint: OK\n";
