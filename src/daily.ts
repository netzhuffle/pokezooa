import { pokemonData } from "./data/pokemon.generated";
import type { PokemonEntry } from "./data/types";

export const FIRST_DAILY_PUZZLE = { year: 2026, month: 4, day: 30 };
export const ZURICH_TIMEZONE = "Europe/Zurich";

// Daily targets are selected from the launch pool by National Dex ID, not array index.
// Only change this when the released Pokémon pool intentionally expands.
const DAILY_TARGET_POOL_SIZE = 1025;

// Offset preserves the first public daily target: #1 on 2026-04-30 is Karippas.
// If the pool size changes, update this only as part of a deliberate sequence migration.
const DAILY_TARGET_ID_OFFSET = 209;

const pokemonById = new Map(pokemonData.map((pokemon) => [pokemon.id, pokemon]));

function zurichDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: ZURICH_TIMEZONE,
    year: "numeric",
  }).formatToParts(date);

  return {
    day: Number(parts.find((part) => part.type === "day")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
}

function utcDayNumber({ year, month, day }: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function dailyPuzzleNumber(date = new Date()): number {
  return utcDayNumber(zurichDateParts(date)) - utcDayNumber(FIRST_DAILY_PUZZLE) + 1;
}

function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): number {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

export function dailyTargetId(puzzleNumber: number): number {
  const random = seededRandom(hashSeed(`pokezooa:${puzzleNumber}`));
  const rawTargetId = Math.floor(random * DAILY_TARGET_POOL_SIZE) + 1;
  return ((rawTargetId + DAILY_TARGET_ID_OFFSET - 1) % DAILY_TARGET_POOL_SIZE) + 1;
}

export function dailyTarget(puzzleNumber: number): PokemonEntry {
  const targetId = dailyTargetId(puzzleNumber);
  const target = pokemonById.get(targetId);
  if (!target) {
    throw new Error(`Daily target ID ${targetId} is missing from the Pokémon dataset`);
  }
  return target;
}
