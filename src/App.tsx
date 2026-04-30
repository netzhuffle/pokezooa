import { useEffect, useMemo, useState } from "react";
import { datasetMeta, pokemonData } from "./data/pokemon.generated";
import type { PokemonEntry } from "./data/types";
import { dailyPuzzleNumber, dailyTarget } from "./daily";
import { buildVisibleTree, groupCount, normalizeName, targetMatch, type VisibleNode } from "./game";

const MAX_TRIES = 20;
const ROUND_STORAGE_KEY = "pokezooa:active-round:v1";
const STREAK_STORAGE_KEY = "pokezooa:daily-streak:v1";
const START_MESSAGE = "Gib ein Pokémon ein und decke den Baum auf.";

interface RoundSnapshot {
  roundNumber: number | null;
  target: PokemonEntry;
  guesses: PokemonEntry[];
  input: string;
  message: string;
  showTable: boolean;
}

interface StoredRoundSnapshot {
  dailyNumber: number;
  guessSlugs: string[];
  input: string;
  message: string;
  roundNumber: number | null;
  showTable: boolean;
  targetSlug: string;
  version: 1;
}

interface StoredStreak {
  current: number;
  lastWonDaily: number;
  version: 1;
}

function randomTarget(): PokemonEntry {
  const random =
    globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? Math.random() * 2 ** 32;
  return pokemonData[Math.floor((random / 2 ** 32) * pokemonData.length)];
}

function pokemonBySlug(slug: string): PokemonEntry | undefined {
  return pokemonData.find((pokemon) => pokemon.slug === slug);
}

function defaultDailyRound(currentDailyNumber: number): RoundSnapshot {
  return {
    guesses: [],
    input: "",
    message: START_MESSAGE,
    roundNumber: currentDailyNumber,
    showTable: false,
    target: dailyTarget(currentDailyNumber),
  };
}

function loadStoredRound(currentDailyNumber: number): RoundSnapshot {
  if (typeof localStorage === "undefined") {
    return defaultDailyRound(currentDailyNumber);
  }

  const raw = localStorage.getItem(ROUND_STORAGE_KEY);
  if (!raw) {
    return defaultDailyRound(currentDailyNumber);
  }

  try {
    const stored = JSON.parse(raw) as Partial<StoredRoundSnapshot>;
    if (stored.version !== 1 || stored.dailyNumber !== currentDailyNumber) {
      return defaultDailyRound(currentDailyNumber);
    }

    const storedRoundNumber = stored.roundNumber;
    const isPracticeRound = storedRoundNumber === null;
    const isDailyRound = typeof storedRoundNumber === "number";
    if (!isPracticeRound && !isDailyRound) {
      return defaultDailyRound(currentDailyNumber);
    }

    const storedTarget = pokemonBySlug(String(stored.targetSlug));
    const target = isDailyRound ? dailyTarget(storedRoundNumber) : storedTarget;
    if (!target) {
      return defaultDailyRound(currentDailyNumber);
    }

    if (isDailyRound && storedTarget && storedTarget.slug !== target.slug) {
      return defaultDailyRound(currentDailyNumber);
    }

    const guesses = (stored.guessSlugs ?? [])
      .map((slug) => pokemonBySlug(slug))
      .filter((pokemon): pokemon is PokemonEntry => Boolean(pokemon));

    return {
      guesses,
      input: String(stored.input ?? ""),
      message: String(stored.message ?? START_MESSAGE),
      roundNumber: isDailyRound ? storedRoundNumber : null,
      showTable: Boolean(stored.showTable),
      target,
    };
  } catch {
    return defaultDailyRound(currentDailyNumber);
  }
}

function saveStoredRound(currentDailyNumber: number, snapshot: RoundSnapshot): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  const stored: StoredRoundSnapshot = {
    dailyNumber: currentDailyNumber,
    guessSlugs: snapshot.guesses.map((guess) => guess.slug),
    input: snapshot.input,
    message: snapshot.message,
    roundNumber: snapshot.roundNumber,
    showTable: snapshot.showTable,
    targetSlug: snapshot.target.slug,
    version: 1,
  };
  localStorage.setItem(ROUND_STORAGE_KEY, JSON.stringify(stored));
}

function loadStoredStreak(): StoredStreak {
  if (typeof localStorage === "undefined") {
    return { current: 0, lastWonDaily: 0, version: 1 };
  }

  try {
    const stored = JSON.parse(
      localStorage.getItem(STREAK_STORAGE_KEY) ?? "",
    ) as Partial<StoredStreak>;
    if (
      stored.version === 1 &&
      typeof stored.current === "number" &&
      typeof stored.lastWonDaily === "number"
    ) {
      return { current: stored.current, lastWonDaily: stored.lastWonDaily, version: 1 };
    }
  } catch {
    // Ignore invalid storage and start a new streak record.
  }

  return { current: 0, lastWonDaily: 0, version: 1 };
}

function recordDailyWin(dailyNumberValue: number): number {
  const streak = loadStoredStreak();
  if (streak.lastWonDaily === dailyNumberValue) {
    return streak.current;
  }

  const nextCurrent = streak.lastWonDaily === dailyNumberValue - 1 ? streak.current + 1 : 1;
  const nextStreak: StoredStreak = {
    current: nextCurrent,
    lastWonDaily: dailyNumberValue,
    version: 1,
  };
  localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(nextStreak));
  return nextCurrent;
}

function formatMeters(value: number): string {
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m`;
}

function formatKilograms(value: number): string {
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg`;
}

type LetterState = "correct" | "present" | "absent";

interface LetterTile {
  character: string;
  state: LetterState;
}

function normalizeLetter(value: string): string {
  return value
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "");
}

function wordleFeedback(guessName: string, targetName: string): LetterTile[] {
  const guessLetters = Array.from(guessName.toLocaleUpperCase("de-DE"));
  const targetLetters = Array.from(targetName.toLocaleUpperCase("de-DE"));
  const guessKeys = guessLetters.map(normalizeLetter);
  const targetKeys = targetLetters.map(normalizeLetter);
  const states: LetterState[] = Array.from({ length: guessLetters.length }, () => "absent");
  const remaining = new Map<string, number>();

  for (let index = 0; index < guessKeys.length; index += 1) {
    if (guessKeys[index] === targetKeys[index]) {
      states[index] = "correct";
    }
  }

  for (let index = 0; index < targetKeys.length; index += 1) {
    if (states[index] !== "correct") {
      remaining.set(targetKeys[index], (remaining.get(targetKeys[index]) ?? 0) + 1);
    }
  }

  for (let index = 0; index < guessKeys.length; index += 1) {
    const key = guessKeys[index];
    if (states[index] === "correct" || !key) {
      continue;
    }

    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      states[index] = "present";
      remaining.set(key, count - 1);
    }
  }

  return guessLetters.map((character, index) => ({ character, state: states[index] }));
}

function LetterGrid({ guesses, target }: { guesses: PokemonEntry[]; target: PokemonEntry }) {
  if (guesses.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border border-[#d0c7aa] bg-white/55 p-4 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-wide text-[#6f7727]">Buchstaben</p>
      <div className="mt-3 grid gap-3">
        {guesses.map((guess) => (
          <div key={guess.slug}>
            <p className="mb-1 text-sm font-bold text-[#5c4b2e]">{guess.name}</p>
            <div className="letter-row" aria-label={`Buchstabenwertung für ${guess.name}`}>
              {wordleFeedback(guess.name, target.name).map((tile, index) => (
                <span
                  // Names can contain repeated letters, so index is the stable per-row key.
                  key={`${guess.slug}-${index}`}
                  className={`letter-tile ${tile.state}`}
                >
                  {tile.character}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function nodeClass(node: VisibleNode): string {
  if (node.state === "root") return "tree-node root";
  if (node.state === "kind") return "tree-node kind";
  if (node.state === "unknown") return "tree-node unknown";
  if (node.state === "correct") return "tree-node correct";
  if (node.state === "guess") return "tree-node guess";
  return "tree-node group";
}

function TreeBranch({
  node,
  onSelect,
}: {
  node: VisibleNode;
  onSelect: (node: VisibleNode) => void;
}) {
  return (
    <li>
      <button className={nodeClass(node)} type="button" onClick={() => onSelect(node)}>
        {node.label}
      </button>
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <TreeBranch key={child.key} node={child} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function splitResultColumns(nodes: VisibleNode[]): [VisibleNode[], VisibleNode[]] {
  const columns: [VisibleNode[], VisibleNode[]] = [[], []];
  const weights = [0, 0];

  for (const node of nodes) {
    const nextColumn = weights[0] <= weights[1] ? 0 : 1;
    columns[nextColumn].push(node);
    weights[nextColumn] += 1 + node.children.length;
  }

  return columns;
}

function ResultColumn({
  nodes,
  onSelect,
}: {
  nodes: VisibleNode[];
  onSelect: (node: VisibleNode) => void;
}) {
  return (
    <section className="min-w-0 rounded-md border border-[#d6c7a1] bg-[#fff7e5]/50">
      <div className="tree-scroll">
        {nodes.length > 0 ? (
          <ul className="poke-tree">
            {nodes.map((node) => (
              <TreeBranch key={node.key} node={node} onSelect={onSelect} />
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-[#d0c7aa] bg-white/45 p-4 font-bold text-[#706133]">
            Noch keine weiteren Treffer.
          </p>
        )}
      </div>
    </section>
  );
}

function DetailPanel({
  selected,
  target,
  solved,
}: {
  selected: VisibleNode | null;
  target: PokemonEntry;
  solved: boolean;
}) {
  if (selected?.pokemon) {
    const pokemon = selected.pokemon;
    return (
      <section className="rounded-md border border-[#74813a] bg-[#eef0d8] p-4 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-[#6f7727]">
              #{pokemon.id.toString().padStart(4, "0")} · {pokemon.generation}
            </p>
            <h2 className="mt-1 text-3xl font-black text-[#17170f]">{pokemon.name}</h2>
            <p className="text-lg font-semibold text-[#516122]">{pokemon.category}</p>
          </div>
          <img
            className="h-20 w-20 shrink-0 object-contain sm:h-24 sm:w-24"
            src={pokemon.sprite}
            alt={pokemon.name}
            loading="lazy"
          />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="font-bold text-[#6f7727]">Typ</dt>
            <dd>{pokemon.types.join(" / ")}</dd>
          </div>
          <div>
            <dt className="font-bold text-[#6f7727]">Region</dt>
            <dd>{pokemon.region}</dd>
          </div>
          <div>
            <dt className="font-bold text-[#6f7727]">Ei-Gruppe</dt>
            <dd>{pokemon.eggGroups.join(" / ")}</dd>
          </div>
          <div>
            <dt className="font-bold text-[#6f7727]">Farbe</dt>
            <dd>{pokemon.color}</dd>
          </div>
          <div>
            <dt className="font-bold text-[#6f7727]">Größe</dt>
            <dd>
              {pokemon.sizeClass} · {formatMeters(pokemon.heightM)}
            </dd>
          </div>
          <div>
            <dt className="font-bold text-[#6f7727]">Gewicht</dt>
            <dd>{formatKilograms(pokemon.weightKg)}</dd>
          </div>
        </dl>
        <a
          className="mt-4 inline-flex font-bold text-[#692018] underline underline-offset-4"
          href={pokemon.pokewikiUrl}
          target="_blank"
        >
          PokéWiki öffnen
        </a>
      </section>
    );
  }

  if (selected) {
    return (
      <section className="rounded-md border border-[#74813a] bg-[#eef0d8] p-4 shadow-lg">
        <p className="text-sm font-bold uppercase tracking-wide text-[#6f7727]">{selected.kind}</p>
        <h2 className="mt-1 text-3xl font-black text-[#17170f]">{selected.label}</h2>
        <p className="mt-3 text-lg leading-relaxed">
          {selected.state === "unknown"
            ? "Hier liegt das gesuchte Pokémon. Der genauere Pfad wird mit deinen nächsten Versuchen freigelegt."
            : `Diese Gruppe enthält ${(selected.count ?? groupCount(selected.key, pokemonData)).toLocaleString("de-DE")} Pokémon im Datensatz.`}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-[#74813a] bg-[#eef0d8] p-4 shadow-lg">
      <p className="text-sm font-bold uppercase tracking-wide text-[#6f7727]">Rätsel</p>
      <h2 className="mt-1 text-3xl font-black text-[#17170f]">
        {solved ? target.name : "Pokémon gesucht"}
      </h2>
      {solved ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-[7rem_1fr]">
          <div className="flex aspect-square items-center justify-center rounded-md border border-[#c5ce93] bg-white/55 p-2">
            <img
              className="h-full w-full object-contain"
              src={target.sprite}
              alt={target.name}
              loading="lazy"
            />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-[#516122]">{target.category}</p>
            <p className="mt-2 text-lg leading-relaxed">
              {target.dexEntry ||
                "Für dieses Pokémon ist kein deutscher Pokédex-Eintrag verfügbar."}
            </p>
            <a
              className="mt-3 inline-flex font-bold text-[#692018] underline underline-offset-4"
              href={target.pokewikiUrl}
              target="_blank"
            >
              PokéWiki öffnen
            </a>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-lg leading-relaxed">
          Wähle einen Knoten im Baum aus, um Details zu sehen. Falsche Tipps zeigen den genauesten
          gemeinsamen Knoten mit der Lösung oder einem früheren Tipp.
        </p>
      )}
    </section>
  );
}

function GuessTable({ guesses, target }: { guesses: PokemonEntry[]; target: PokemonEntry }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-md border border-[#d0c7aa] bg-white/65">
      <table className="w-max min-w-full text-left text-sm">
        <thead className="bg-[#f3e7ce] text-[#5f381f]">
          <tr>
            <th className="px-3 py-2">Tipp</th>
            <th className="px-3 py-2">Region</th>
            <th className="px-3 py-2">Typ</th>
            <th className="px-3 py-2">Ei-Gruppe</th>
            <th className="px-3 py-2">Größe</th>
            <th className="px-3 py-2">Farbe</th>
          </tr>
        </thead>
        <tbody>
          {guesses.map((guess) => {
            const match = targetMatch(guess, target);
            return (
              <tr key={guess.slug} className="border-t border-[#e2d8be]">
                <td className="px-3 py-2 font-bold">{guess.name}</td>
                <td className={match.region ? "px-3 py-2 font-bold text-[#1d6b3f]" : "px-3 py-2"}>
                  {guess.region}
                </td>
                <td
                  className={
                    match.types.length > 0 ? "px-3 py-2 font-bold text-[#1d6b3f]" : "px-3 py-2"
                  }
                >
                  {guess.types.join(" / ")}
                </td>
                <td
                  className={
                    match.eggGroups.length > 0 ? "px-3 py-2 font-bold text-[#1d6b3f]" : "px-3 py-2"
                  }
                >
                  {guess.eggGroups.join(" / ")}
                </td>
                <td className={match.size ? "px-3 py-2 font-bold text-[#1d6b3f]" : "px-3 py-2"}>
                  {formatMeters(guess.heightM)}
                  {match.size ? ` · ${match.size}` : ""}
                </td>
                <td className={match.color ? "px-3 py-2 font-bold text-[#1d6b3f]" : "px-3 py-2"}>
                  {guess.color}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [currentDailyNumber] = useState(() => dailyPuzzleNumber());
  const [initialSnapshot] = useState(() => loadStoredRound(currentDailyNumber));
  const [roundNumber, setRoundNumber] = useState<number | null>(initialSnapshot.roundNumber);
  const [target, setTarget] = useState(initialSnapshot.target);
  const [guesses, setGuesses] = useState<PokemonEntry[]>(initialSnapshot.guesses);
  const [input, setInput] = useState(initialSnapshot.input);
  const [message, setMessage] = useState(initialSnapshot.message);
  const [showTable, setShowTable] = useState(initialSnapshot.showTable);
  const [selected, setSelected] = useState<VisibleNode | null>(null);

  const guessedTarget = guesses.some((guess) => guess.slug === target.slug);
  const outOfTries = guesses.length >= MAX_TRIES && !guessedTarget;
  const done = guessedTarget || outOfTries;
  const revealAnswer = guessedTarget || outOfTries;
  const remaining = Math.max(0, MAX_TRIES - guesses.length);
  const tree = useMemo(
    () => buildVisibleTree(target, guesses, revealAnswer, pokemonData),
    [target, guesses, revealAnswer],
  );
  const resultColumns = useMemo(() => splitResultColumns(tree.children), [tree]);
  const lookup = useMemo(
    () => new Map(pokemonData.map((pokemon) => [normalizeName(pokemon.name), pokemon])),
    [],
  );

  useEffect(() => {
    saveStoredRound(currentDailyNumber, {
      guesses,
      input,
      message,
      roundNumber,
      showTable,
      target,
    });
  }, [currentDailyNumber, guesses, input, message, roundNumber, showTable, target]);

  function submitGuess(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (done) return;

    const normalized = normalizeName(input);
    const pokemon = lookup.get(normalized);
    if (!pokemon) {
      setMessage("Dieses Pokémon ist nicht im Datensatz. Prüfe die deutsche Schreibweise.");
      return;
    }

    if (guesses.some((guess) => guess.slug === pokemon.slug)) {
      setMessage(`${pokemon.name} wurde bereits geraten.`);
      return;
    }

    const nextGuesses = [...guesses, pokemon];
    setGuesses(nextGuesses);
    setInput("");
    setSelected(null);

    if (pokemon.slug === target.slug) {
      const attemptLabel = nextGuesses.length === 1 ? "Versuch" : "Versuche";
      if (roundNumber === null) {
        setMessage(
          `Gewonnen! Du hast ${nextGuesses.length} ${attemptLabel} gebraucht. Die Antwort ist ${target.name}.`,
        );
      } else {
        const streak = recordDailyWin(roundNumber);
        setMessage(
          `Gewonnen! Du hast ${nextGuesses.length} ${attemptLabel} gebraucht. Aktuelle Serie: ${streak}. Die Antwort ist ${target.name}.`,
        );
      }
    } else if (nextGuesses.length >= MAX_TRIES) {
      setMessage(`Keine Versuche mehr. Die Antwort war ${target.name}.`);
    } else {
      setMessage(`${pokemon.name} ist es nicht. Der Baum wurde erweitert.`);
    }
  }

  function newRound(): void {
    setTarget(randomTarget());
    setRoundNumber(null);
    setGuesses([]);
    setInput("");
    setMessage("Neue Runde. Gib ein Pokémon ein und decke den Baum auf.");
    setSelected(null);
    setShowTable(false);
  }

  async function shareScore(): Promise<void> {
    const prefix = roundNumber === null ? "Pokézooa Übungsrunde" : `Pokézooa #${roundNumber}`;
    const text = `${prefix}: ${guessedTarget ? guesses.length : "X"}/${MAX_TRIES} - ${target.name}`;
    await navigator.clipboard?.writeText(text);
    setMessage("Punktzahl kopiert.");
  }

  return (
    <main className="min-h-svh overflow-x-hidden px-4 py-4 text-[#202015] md:px-7">
      <header className="mx-auto grid max-w-[96rem] grid-cols-[1fr_auto] items-end gap-3 border-b-2 border-[#211b12] pb-3 sm:grid-cols-[auto_1fr_auto]">
        <div className="hidden items-center gap-3 text-3xl sm:flex" aria-hidden="true">
          <span>◓</span>
          <span>◆</span>
        </div>
        <h1 className="min-w-0 text-left text-4xl font-black leading-none sm:text-center sm:text-5xl md:text-6xl">
          Pokézooa
        </h1>
        <div className="text-right text-xs font-bold text-[#5e563f] sm:text-sm">
          <p>{datasetMeta.count.toLocaleString("de-DE")} Pokémon</p>
          <p>Deutsch</p>
        </div>
      </header>

      <div className="game-layout mx-auto max-w-[112rem] py-7">
        <aside className="min-w-0 space-y-6">
          <section>
            <h2 className="break-words text-3xl font-black sm:text-4xl">
              {roundNumber === null ? "Übungsrunde" : `Rätsel-Pokémon #${roundNumber}`}
            </h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-[1fr_auto]">
              <p className="text-2xl font-semibold leading-relaxed">{message}</p>
              <div className="text-center">
                <p className="text-4xl font-black">{remaining}</p>
                <p className="font-semibold">verbleibend</p>
              </div>
            </div>

            <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={submitGuess}>
              <input
                className="min-h-12 flex-1 rounded-sm border-2 border-[#6e6d61] bg-[#f4f5f0] px-3 text-xl outline-none focus:border-[#8d2b20]"
                list="pokemon-options"
                value={input}
                disabled={done}
                aria-label="Pokémon raten"
                onChange={(event) => setInput(event.target.value)}
              />
              <datalist id="pokemon-options">
                {pokemonData.map((pokemon) => (
                  <option key={pokemon.slug} value={pokemon.name} />
                ))}
              </datalist>
              <button
                className="min-h-12 rounded-md border-2 border-[#5c6673] bg-[#dce4ed] px-5 text-xl font-bold disabled:cursor-not-allowed disabled:opacity-55"
                disabled={done || input.trim().length === 0}
                type="submit"
              >
                Raten
              </button>
            </form>

            <div className="mt-5 flex max-w-full flex-wrap gap-4">
              <button
                className="max-w-full rounded-md border border-[#b59cea] bg-white px-5 py-3 text-lg font-bold text-[#5b2aa0] shadow-sm disabled:opacity-55"
                disabled={!done}
                type="button"
                onClick={() => void shareScore()}
              >
                Teilen
              </button>
              <button
                className="max-w-full rounded-md border border-[#9ac8aa] bg-white px-5 py-3 text-lg font-bold text-[#245938] shadow-sm"
                type="button"
                onClick={newRound}
              >
                Übungsrunde
              </button>
              <button
                className="max-w-full rounded-md border border-[#d0c7aa] bg-white px-5 py-3 text-lg font-bold text-[#4f3b22] shadow-sm"
                type="button"
                onClick={() => setShowTable((current) => !current)}
              >
                {showTable ? "Tabelle ausblenden" : "Tabelle anzeigen"}
              </button>
            </div>
          </section>

          <LetterGrid guesses={guesses} target={target} />

          <DetailPanel selected={selected} solved={revealAnswer} target={target} />

          {showTable ? <GuessTable guesses={guesses} target={target} /> : null}

          <p className="text-sm leading-relaxed text-[#61573d]">
            Daten: {datasetMeta.source} Erstellt am{" "}
            {new Date(datasetMeta.generatedAt).toLocaleDateString("de-DE")}.
          </p>
        </aside>

        <ResultColumn nodes={resultColumns[0]} onSelect={setSelected} />
        <ResultColumn nodes={resultColumns[1]} onSelect={setSelected} />
      </div>
    </main>
  );
}

export default App;
