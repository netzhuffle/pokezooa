# Pokézooa

Pokézooa ist ein Metazooa-inspiriertes Ratespiel für Pokémon. Du hast maximal 20 Versuche; jeder falsche Tipp erweitert den Baum um die genaueste gemeinsame Kategorie mit der Lösung oder einem früheren Tipp.

## Entwicklung

```fish
bun install
bun run generate:data
bun run dev
```

## Checks

```fish
bun run format:check
bun run test
bun run lint
bun run build
```

## Deployment

Pushes to `main` deploy the static build through GitHub Actions. Configure these repository
secrets before relying on the workflow:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_PATH`
- `DEPLOY_PORT` (optional; defaults to `22`)

Die Pokémon-Daten werden in `src/data/pokemon.generated.ts` generiert. Grundlage sind PokéAPI-Metadaten mit deutschen Lokalisierungen; die App verlinkt pro Pokémon auf die passende PokéWiki-Seite.
