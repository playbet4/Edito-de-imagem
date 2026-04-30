# Processador de Logo Imobiliário

React + Vite + TypeScript single-page app for uploading a logo, removing backgrounds (local chroma-style removal or Remove.bg), cropping to content, exporting PNG presets, and optional Gemini-powered brand kit suggestions.

## Setup

```bash
npm install
npm run dev
```

## Gemini (“Analisar Marca com IA”)

1. Copy `.env.example` to `.env` in the project root.
2. Set `VITE_GEMINI_API_KEY` to a key from [Google AI Studio](https://aistudio.google.com/apikey).
3. Restart the dev server (`npm run dev`) so Vite picks up the variable.

Optional: set `VITE_GEMINI_MODEL` (defaults to `gemini-2.0-flash`).

**Note:** Keys prefixed with `VITE_` are embedded in the client bundle. For production, call Gemini from a backend or Edge Function so the key stays server-side.

## Scripts

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Start dev server         |
| `npm run build`| Production build         |
| `npm run lint` | ESLint                   |
| `npm run typecheck` | TypeScript check |
