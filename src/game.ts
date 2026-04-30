import type { PokemonEntry } from "./data/types";

export type SegmentKind =
  | "Wurzel"
  | "Merkmal"
  | "Region"
  | "Typ"
  | "Ei-Gruppe"
  | "Kategorie"
  | "Größe"
  | "Farbe"
  | "Pokémon"
  | "Unbekannt";

export interface PathSegment {
  key: string;
  label: string;
  kind: SegmentKind;
  count?: number;
  pokemon?: PokemonEntry;
}

export interface VisibleNode extends PathSegment {
  children: VisibleNode[];
  state: "root" | "kind" | "group" | "guess" | "correct" | "unknown";
}

export interface TargetMatch {
  region: boolean;
  types: string[];
  eggGroups: string[];
  category: boolean;
  size: string | null;
  color: boolean;
}

interface Feature extends PathSegment {
  order: number;
  matches: (pokemon: PokemonEntry) => boolean;
}

const SIZE_THRESHOLDS = [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.5, 3, 4, 6, 10];
const KIND_ORDER: Record<SegmentKind, number> = {
  Wurzel: 0,
  Merkmal: 0,
  Region: 1,
  Typ: 2,
  "Ei-Gruppe": 3,
  Kategorie: 4,
  Größe: 5,
  Farbe: 6,
  Pokémon: 7,
  Unbekannt: 8,
};
const KIND_LABELS: Record<SegmentKind, string> = {
  Wurzel: "Pokémon",
  Merkmal: "Merkmal",
  Region: "Region",
  Typ: "Typ",
  "Ei-Gruppe": "Ei-Gruppe",
  Kategorie: "Kategorie",
  Größe: "Größe",
  Farbe: "Farbe",
  Pokémon: "Pokémon",
  Unbekannt: "Unbekannt",
};
const RESULT_KINDS = ["Region", "Typ", "Ei-Gruppe", "Kategorie", "Größe", "Farbe"] as const;

export function normalizeName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .replaceAll("♀", "f")
    .replaceAll("♂", "m")
    .replaceAll(/[^a-z0-9]+/g, "");
}

function metersLabel(value: number): string {
  const centimeters = Math.round(value * 100);
  if (centimeters < 100) {
    return `${centimeters} cm`;
  }

  return `${value.toLocaleString("de-DE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  })} m`;
}

function inclusiveRangeLabel(startM: number, endM: number): string {
  const startCm = Math.round(startM * 100);
  const lastIncludedCm = Math.round(endM * 100) - 1;

  if (lastIncludedCm < 100) {
    return `${startCm}-${lastIncludedCm} cm`;
  }

  return `${metersLabel(startM)}-${metersLabel(lastIncludedCm / 100)}`;
}

function feature(
  kind: SegmentKind,
  rawLabel: string,
  matches: (pokemon: PokemonEntry) => boolean,
): Feature {
  return {
    key: `${kind}:${rawLabel}`,
    label: rawLabel,
    kind,
    order: KIND_ORDER[kind],
    matches,
  };
}

function pokemonFeatures(pokemon: PokemonEntry): Feature[] {
  return [
    feature("Region", pokemon.region, (entry) => entry.region === pokemon.region),
    ...pokemon.types.map((type) =>
      feature("Typ", type, (entry) => entry.types.some((entryType) => entryType === type)),
    ),
    ...pokemon.eggGroups.map((eggGroup) =>
      feature("Ei-Gruppe", eggGroup, (entry) =>
        entry.eggGroups.some((entryEggGroup) => entryEggGroup === eggGroup),
      ),
    ),
    feature("Kategorie", pokemon.category, (entry) => entry.category === pokemon.category),
    feature("Farbe", pokemon.color, (entry) => entry.color === pokemon.color),
  ];
}

function bandFor(heightM: number): { start: number; end: number } {
  const end = SIZE_THRESHOLDS.find((threshold) => heightM < threshold) ?? Infinity;
  const start = [0, ...SIZE_THRESHOLDS].findLast((threshold) => threshold <= heightM) ?? 0;
  return { start, end };
}

function sizeFeature(left: PokemonEntry, right: PokemonEntry): Feature | null {
  const leftBand = bandFor(left.heightM);
  const rightBand = bandFor(right.heightM);

  if (leftBand.start !== rightBand.start || leftBand.end !== rightBand.end) {
    return null;
  }

  const label =
    leftBand.start === 0
      ? `< ${metersLabel(leftBand.end)}`
      : leftBand.end === Infinity
        ? `>= ${metersLabel(leftBand.start)}`
        : inclusiveRangeLabel(leftBand.start, leftBand.end);

  return feature("Größe", label, (entry) => {
    const entryBand = bandFor(entry.heightM);
    return entryBand.start === leftBand.start && entryBand.end === leftBand.end;
  });
}

function sharedFeatures(left: PokemonEntry, right: PokemonEntry): Feature[] {
  const rightKeys = new Set(pokemonFeatures(right).map((item) => item.key));
  const shared = pokemonFeatures(left).filter((item) => rightKeys.has(item.key));
  const sharedSize = sizeFeature(left, right);
  if (sharedSize) {
    shared.push(sharedSize);
  }
  return dedupeFeatures(shared);
}

function dedupeFeatures(features: Feature[]): Feature[] {
  return features.filter(
    (featureItem, index) =>
      features.findIndex((candidate) => candidate.key === featureItem.key) === index,
  );
}

function emptyNode(segment: PathSegment, state: VisibleNode["state"]): VisibleNode {
  return {
    ...segment,
    state,
    children: [],
  };
}

function addChild(
  parent: VisibleNode,
  segment: PathSegment,
  state: VisibleNode["state"],
): VisibleNode {
  let child = parent.children.find((node) => node.key === segment.key);
  if (!child) {
    child = emptyNode(segment, state);
    parent.children.push(child);
  }
  if (state === "correct" || child.state === "unknown") {
    child.state = state;
  }
  return child;
}

function addPokemonLeaf(
  parent: VisibleNode,
  pokemon: PokemonEntry,
  state: VisibleNode["state"],
): void {
  addChild(
    parent,
    {
      key: `pokemon:${pokemon.slug}`,
      label: pokemon.name,
      kind: "Pokémon",
      pokemon,
    },
    state,
  );
}

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % length;
}

function parkingKindFor(target: PokemonEntry, guess: PokemonEntry): (typeof RESULT_KINDS)[number] {
  return RESULT_KINDS[stableIndex(`${target.slug}:${guess.slug}`, RESULT_KINDS.length)];
}

function sortTree(node: VisibleNode): VisibleNode {
  node.children.sort((left, right) => {
    const stateRank = { kind: 0, group: 1, root: 1, unknown: 2, correct: 3, guess: 4 };
    const kindDiff = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    const stateDiff = stateRank[left.state] - stateRank[right.state];
    return kindDiff || stateDiff || left.label.localeCompare(right.label, "de");
  });

  node.children.forEach(sortTree);
  return node;
}

function revealedFeatures(
  target: PokemonEntry,
  guesses: PokemonEntry[],
  entries: PokemonEntry[],
): Feature[] {
  const features: Feature[] = [];
  const pool = [target, ...guesses];

  for (let leftIndex = 0; leftIndex < pool.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < pool.length; rightIndex += 1) {
      features.push(...sharedFeatures(pool[leftIndex], pool[rightIndex]));
    }
  }

  return dedupeFeatures(features).map((featureItem) => ({
    ...featureItem,
    count: entries.filter(featureItem.matches).length,
  }));
}

export function buildVisibleTree(
  target: PokemonEntry,
  guesses: PokemonEntry[],
  solved: boolean,
  entries: PokemonEntry[],
): VisibleNode {
  const root = emptyNode(
    { key: "root:pokemon", label: "Pokémon", kind: "Wurzel", count: entries.length },
    "root",
  );
  const uniqueGuesses = guesses.filter(
    (guess, index) => guesses.findIndex((item) => item.slug === guess.slug) === index,
  );
  const features = revealedFeatures(target, uniqueGuesses, entries);
  const displayedGuesses = new Set<string>();
  let targetShown = false;
  const kindNodes = new Map<(typeof RESULT_KINDS)[number], VisibleNode>();

  for (const resultKind of RESULT_KINDS) {
    kindNodes.set(
      resultKind,
      addChild(
        root,
        {
          key: `kind:${resultKind}`,
          label: KIND_LABELS[resultKind],
          kind: "Merkmal",
          count: entries.length,
        },
        "kind",
      ),
    );
  }

  for (const featureItem of features) {
    const kindNode = kindNodes.get(featureItem.kind as (typeof RESULT_KINDS)[number]) ?? root;
    const featureNode = addChild(kindNode, featureItem, "group");

    for (const guess of uniqueGuesses.filter(featureItem.matches)) {
      addPokemonLeaf(featureNode, guess, guess.slug === target.slug ? "correct" : "guess");
      displayedGuesses.add(guess.slug);
    }

    if (featureItem.matches(target)) {
      if (solved) {
        addPokemonLeaf(featureNode, target, "correct");
      } else {
        addChild(
          featureNode,
          { key: `unknown:${featureItem.key}`, label: "???", kind: "Unbekannt" },
          "unknown",
        );
      }
      targetShown = true;
    }
  }

  const unmatchedGuesses = uniqueGuesses.filter((guess) => !displayedGuesses.has(guess.slug));
  for (const guess of unmatchedGuesses) {
    const kindNode = kindNodes.get(parkingKindFor(target, guess)) ?? root;
    addPokemonLeaf(kindNode, guess, "guess");
  }

  if (!targetShown) {
    if (solved) {
      addPokemonLeaf(root, target, "correct");
    } else {
      addChild(root, { key: "unknown:target", label: "???", kind: "Unbekannt" }, "unknown");
    }
  }

  return sortTree(root);
}

export function groupCount(segmentKey: string, entries: PokemonEntry[]): number {
  if (segmentKey === "root:pokemon" || segmentKey.startsWith("kind:")) {
    return entries.length;
  }

  return 0;
}

export function targetMatch(guess: PokemonEntry, target: PokemonEntry): TargetMatch {
  return {
    region: guess.region === target.region,
    types: guess.types.filter((type) => target.types.some((targetType) => targetType === type)),
    eggGroups: guess.eggGroups.filter((eggGroup) =>
      target.eggGroups.some((targetEggGroup) => targetEggGroup === eggGroup),
    ),
    category: guess.category === target.category,
    size: sizeFeature(guess, target)?.label ?? null,
    color: guess.color === target.color,
  };
}
