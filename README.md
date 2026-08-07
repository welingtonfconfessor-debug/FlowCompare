# FlowCompare

FlowCompare e um aplicativo PHP para importar, sobrepor e comparar dois arquivos DXF. O PHP entrega a pagina e os assets compilados; o motor CAD roda no navegador para manter zoom, medicao e analise geometrica responsivos.

## Arquitetura

- `public/index.php`: entrada HTTP e document root seguro da aplicacao.
- `php/AssetManifest.php`: leitura segura do manifesto gerado pelo Vite.
- `frontend/main.tsx`: montagem do frontend no HTML entregue pelo PHP.
- `app/components/FlowCompareWorkspace.tsx`: area de trabalho e controles.
- `app/lib/dxf.ts`: leitura do DXF e normalizacao para milimetros.
- `app/lib/geometry.ts`: segmentos, limites, medidas e transformacoes.
- `app/lib/comparison.ts`: tolerancia, classificacao e similaridade.
- `app/lib/report.ts`: relatorio PDF com logo, imagem e divergencias reais.
- `public/build`: frontend compilado que o PHP serve em producao.

## Requisitos

- PHP 8.2 ou superior.
- Node.js 22.13 ou superior apenas para compilar o frontend.
- pnpm 11.

O servidor de producao precisa apenas de PHP e dos arquivos ja compilados em `public/build`.

## Execucao local

Instale e compile os assets:

```powershell
pnpm install
pnpm build
```

Inicie o PHP:

```powershell
php -S 127.0.0.1:8000 -t public
```

Acesse `http://127.0.0.1:8000/`.

Para desenvolvimento com atualizacao instantanea, execute o Vite em um terminal:

```powershell
pnpm dev
```

E inicie o PHP em outro terminal informando o servidor do Vite:

```powershell
$env:FLOWCOMPARE_VITE_DEV_SERVER="http://127.0.0.1:5173"
php -S 127.0.0.1:8000 -t public
```

## Validacao

```powershell
pnpm test:geometry
pnpm test:alignment
pnpm test:canvas-tools
pnpm test:report
pnpm test
pnpm lint
```

## Funcionalidades

- Importacao de dois DXFs por seletor ou arrastar e soltar.
- Sobreposicao com cores independentes para Referencia A e Arquivo B.
- Zoom, navegacao, enquadramento e arraste do Arquivo B.
- Alinhamento automatico e ajustes manuais de X, Y e rotacao.
- Tolerancia em milimetros e classificacao das divergencias.
- Comparacao de dimensoes, contornos, furos, recortes e linhas de dobra.
- Regua com captura em linhas, extremidades e intersecoes do Arquivo B.
- Filtro para mostrar apenas diferencas.
- Exportacao PNG e relatorio PDF com os resultados reais.

## Entidades DXF suportadas

`LINE`, `LWPOLYLINE`, `POLYLINE`, `CIRCLE`, `ARC`, `ELLIPSE` e `SPLINE`.

Camadas contendo `BEND`, `FOLD`, `DOBRA` ou `VINCO` sao identificadas separadamente para a futura comparacao dedicada de dobras.
