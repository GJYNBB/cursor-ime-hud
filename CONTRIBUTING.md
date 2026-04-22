# Contributing

## Development

```powershell
npm install
npm run compile
npm run build:helper
npm test
```

## Debugging

1. Open this workspace in VS Code.
2. Run the commands above once.
3. Press `F5` to start the Extension Development Host.

## Pull Requests

- Keep the scope focused on IME state display only.
- Do not add automatic IME switching or semantic language heuristics.
- Keep Windows detection logic inside the detector/helper layer, not in UI rendering code.
- Update `README.md` and `CHANGELOG.md` when behavior changes.
