# Rendered diagrams

These PNGs are convenience copies of the six most important diagrams in
[`../../AUTHORIZATION_DIAGRAMS.md`](../../AUTHORIZATION_DIAGRAMS.md). The Mermaid
blocks in that file are the source of truth.

| PNG | Mermaid section |
| --- | --- |
| `database-er.png` | 1.1 Entity-relationship diagram |
| `tenant-role-keys.png` | 1.3 The important key relationships |
| `permission-resolution.png` | 1.4 Permission resolution |
| `invite-lifecycle.png` | 1.5 Invitation state machine |
| `api-module-map.png` | 3.1 How the modules depend on each other |
| `request-lifecycle.png` | 4.1 Every authenticated organization request |

## Regenerating

1. Copy one Mermaid block from `AUTHORIZATION_DIAGRAMS.md` into a `.mmd` file.
2. Render it with Mermaid CLI:

```bash
npx -y @mermaid-js/mermaid-cli \
  -i diagram.mmd \
  -o database-er.png \
  -s 2
```

`-s 2` renders at 2× scale for readable text.

If Puppeteer cannot find a browser, point it at an installed Chromium/Chrome:

```json
{
  "executablePath": "/path/to/brave-or-chrome",
  "args": ["--no-sandbox"]
}
```

```bash
npx -y @mermaid-js/mermaid-cli -p puppeteer-config.json -i diagram.mmd -o out.png -s 2
```
