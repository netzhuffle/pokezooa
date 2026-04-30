export interface PokemonEntry {
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

export interface DatasetMeta {
  generatedAt: string;
  source: string;
  count: number;
}
