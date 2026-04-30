import { mkdir, writeFile } from "node:fs/promises";

interface NamedApiResource {
  name: string;
  url: string;
}

interface LocalizedName {
  language: NamedApiResource;
  name?: string;
  genus?: string;
}

interface PokemonSpecies {
  id: number;
  name: string;
  names: LocalizedName[];
  genera: LocalizedName[];
  color: NamedApiResource;
  egg_groups: NamedApiResource[];
  generation: NamedApiResource;
  varieties: Array<{
    is_default: boolean;
    pokemon: NamedApiResource;
  }>;
}

interface PokemonDetail {
  height: number;
  weight: number;
  sprites: {
    front_default: string | null;
    other?: {
      "official-artwork"?: {
        front_default: string | null;
      };
    };
  };
  types: Array<{
    slot: number;
    type: NamedApiResource;
  }>;
}

interface PokemonEntry {
  id: number;
  slug: string;
  name: string;
  category: string;
  region: string;
  generation: string;
  types: string[];
  eggGroups: string[];
  color: string;
  sizeClass: string;
  heightM: number;
  weightKg: number;
  sprite: string;
  pokewikiUrl: string;
}

const API_ROOT = "https://pokeapi.co/api/v2";
const OUT_FILE = new URL("../src/data/pokemon.generated.ts", import.meta.url);

const REGION_BY_GENERATION: Record<string, string> = {
  "generation-i": "Kanto",
  "generation-ii": "Johto",
  "generation-iii": "Hoenn",
  "generation-iv": "Sinnoh",
  "generation-v": "Einall",
  "generation-vi": "Kalos",
  "generation-vii": "Alola",
  "generation-viii": "Galar",
  "generation-ix": "Paldea",
};

const GENERATION_LABELS: Record<string, string> = {
  "generation-i": "Generation I",
  "generation-ii": "Generation II",
  "generation-iii": "Generation III",
  "generation-iv": "Generation IV",
  "generation-v": "Generation V",
  "generation-vi": "Generation VI",
  "generation-vii": "Generation VII",
  "generation-viii": "Generation VIII",
  "generation-ix": "Generation IX",
};

const COLOR_LABELS: Record<string, string> = {
  black: "Schwarz",
  blue: "Blau",
  brown: "Braun",
  gray: "Grau",
  green: "Grün",
  pink: "Rosa",
  purple: "Violett",
  red: "Rot",
  white: "Weiß",
  yellow: "Gelb",
};

const cache = new Map<string, unknown>();

async function fetchJson<T>(url: string): Promise<T> {
  const cached = cache.get(url);
  if (cached) {
    return cached as T;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      const json = (await response.json()) as T;
      cache.set(url, json);
      return json;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 450));
  }

  throw new Error(`Failed to fetch ${url}`);
}

function localized(names: LocalizedName[], fallback: string): string {
  return (
    names.find((entry) => entry.language.name === "de")?.name ??
    names.find((entry) => entry.language.name === "de")?.genus ??
    names.find((entry) => entry.language.name === "en")?.name ??
    names.find((entry) => entry.language.name === "en")?.genus ??
    fallback
  );
}

function sizeClass(heightM: number): string {
  if (heightM < 0.4) return "Winzig";
  if (heightM < 0.8) return "Klein";
  if (heightM < 1.5) return "Mittelgroß";
  if (heightM < 2.5) return "Groß";
  return "Riesig";
}

function pokewikiUrl(name: string): string {
  return `https://www.pokewiki.de/${encodeURIComponent(name).replaceAll("%20", "_")}`;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

async function localizedResource(resource: NamedApiResource): Promise<string> {
  const data = await fetchJson<{ names: LocalizedName[] }>(resource.url);
  return localized(data.names, resource.name);
}

async function buildEntry(resource: NamedApiResource, index: number): Promise<PokemonEntry | null> {
  const species = await fetchJson<PokemonSpecies>(resource.url);
  const germanName = localized(species.names, species.name);
  const defaultVariety =
    species.varieties.find((variety) => variety.is_default)?.pokemon ??
    species.varieties[0]?.pokemon;

  if (!defaultVariety || !germanName) {
    return null;
  }

  const pokemon = await fetchJson<PokemonDetail>(defaultVariety.url);
  const types = await Promise.all(
    [...pokemon.types]
      .sort((left, right) => left.slot - right.slot)
      .map((slot) => localizedResource(slot.type)),
  );
  const eggGroups = await Promise.all(species.egg_groups.map(localizedResource));
  const color = await localizedResource(species.color).catch(
    () => COLOR_LABELS[species.color.name] ?? species.color.name,
  );
  const heightM = pokemon.height / 10;
  const artwork = pokemon.sprites.other?.["official-artwork"]?.front_default;
  const fallbackSprite = pokemon.sprites.front_default;

  if (!artwork && !fallbackSprite) {
    return null;
  }

  if (index % 100 === 0) {
    console.log(`Loaded ${index}/${index === 0 ? "..." : ""}`);
  }

  return {
    id: species.id,
    slug: species.name,
    name: germanName,
    category: localized(species.genera, "Pokémon"),
    region: REGION_BY_GENERATION[species.generation.name] ?? "Unbekannte Region",
    generation: GENERATION_LABELS[species.generation.name] ?? species.generation.name,
    types,
    eggGroups: eggGroups.length > 0 ? eggGroups : ["Unbekannt"],
    color,
    sizeClass: sizeClass(heightM),
    heightM,
    weightKg: pokemon.weight / 10,
    sprite: artwork ?? fallbackSprite ?? "",
    pokewikiUrl: pokewikiUrl(germanName),
  };
}

async function main(): Promise<void> {
  const list = await fetchJson<{ results: NamedApiResource[] }>(
    `${API_ROOT}/pokemon-species?limit=2000`,
  );
  const entries = (
    await mapLimit(list.results, 18, (resource, index) => buildEntry(resource, index))
  )
    .filter((entry): entry is PokemonEntry => Boolean(entry))
    .sort((left, right) => left.id - right.id);

  const generated = `// Generated by scripts/generate-data.ts. Do not edit by hand.
import type { DatasetMeta, PokemonEntry } from "./types"

export const datasetMeta: DatasetMeta = ${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source:
        "Pokémon species metadata from PokéAPI with German localizations; PokéWiki links are generated for German source/reference pages.",
      count: entries.length,
    },
    null,
    2,
  )} as const

export const pokemonData: PokemonEntry[] = ${JSON.stringify(entries, null, 2)}
`;

  await mkdir(new URL("../src/data", import.meta.url), { recursive: true });
  await writeFile(OUT_FILE, generated);
  console.log(`Wrote ${entries.length} Pokémon to ${OUT_FILE.pathname}`);
}

await main();
