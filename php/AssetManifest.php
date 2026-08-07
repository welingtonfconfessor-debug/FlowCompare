<?php

declare(strict_types=1);

namespace FlowCompare;

use RuntimeException;

final class AssetManifest
{
    /** @var array<string, array<string, mixed>> */
    private array $entries;

    public function __construct(
        string $manifestPath,
        private readonly string $publicBase = '/build/',
    ) {
        if (!is_file($manifestPath)) {
            throw new RuntimeException('Os arquivos do frontend ainda nao foram compilados.');
        }

        $contents = file_get_contents($manifestPath);
        $decoded = $contents === false ? null : json_decode($contents, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('O manifesto de assets do frontend e invalido.');
        }

        $this->entries = $decoded;
    }

    /**
     * @return array{script: string, styles: list<string>}
     */
    public function entry(string $source): array
    {
        $entry = $this->entries[$source] ?? null;
        if (!is_array($entry) || !isset($entry['file']) || !is_string($entry['file'])) {
            throw new RuntimeException("A entrada {$source} nao foi encontrada no manifesto.");
        }

        $styles = [];
        foreach ($entry['css'] ?? [] as $stylesheet) {
            if (is_string($stylesheet)) {
                $styles[] = $this->assetUrl($stylesheet);
            }
        }

        return [
            'script' => $this->assetUrl($entry['file']),
            'styles' => $styles,
        ];
    }

    private function assetUrl(string $asset): string
    {
        return rtrim($this->publicBase, '/') . '/' . ltrim($asset, '/');
    }
}
