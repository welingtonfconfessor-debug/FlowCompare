# FlowCompare

FlowCompare é uma base web para importar, sobrepor e comparar dois arquivos DXF. A interface segue uma linguagem escura de desenho técnico e mantém os cálculos separados da apresentação.

## Estrutura

- `app/components/FlowCompareWorkspace.tsx`: área de trabalho, importação, controles e visualização SVG.
- `app/lib/dxf.ts`: leitura do arquivo DXF e normalização das unidades para milímetros.
- `app/lib/geometry.ts`: conversão de entidades em segmentos, limites, medidas e transformações.
- `app/lib/comparison.ts`: comparação geométrica, tolerância, classificação e similaridade.
- `app/types.ts`: contratos compartilhados do domínio.
- `tests/geometry-comparison.test.ts`: testes com geometria DXF real, sem resultados fixos na interface.

## Funcionalidades atuais

- Importação individual ou por arrastar e soltar de dois DXFs.
- Visualização sobreposta com cores independentes para A e B.
- Zoom pelo mouse, movimentação e ajuste à tela.
- Alinhamento automático pelos limites ou pela origem.
- Ajuste manual de X, Y e rotação.
- Tolerância em milímetros e classificação em correto, pequena diferença e grande diferença.
- Destaque no desenho e lista lateral gerados pela geometria importada.
- Métricas de largura, comprimento, extensão geométrica, furos, recortes, contornos e camadas de dobra.
- Filtro para mostrar somente diferenças e opção de ignorar geometrias internas.
- Exportação da comparação em PNG.
- Relatório PDF com arquivos, tolerância, alinhamento, métricas, imagem da sobreposição e divergências classificadas.

## Entidades DXF suportadas

`LINE`, `LWPOLYLINE`, `POLYLINE`, `CIRCLE`, `ARC`, `ELLIPSE` e `SPLINE`. Curvas são discretizadas em segmentos para renderização e comparação.

Linhas em camadas cujo nome contém `BEND`, `FOLD`, `DOBRA` ou `VINCO` já são identificadas separadamente, preparando a comparação específica de dobras.

## Próximas extensões

- Emparelhamento topológico avançado entre entidades equivalentes.
- Alinhamento por pontos, furos ou contorno com estimativa automática de rotação.
- Comparação dedicada de linhas de dobra.
- Assinatura e histórico de versões dos relatórios PDF.

## Execução

```powershell
pnpm install
pnpm dev
```

Testes e validação:

```powershell
pnpm test:geometry
pnpm test:report
pnpm test
pnpm lint
```
