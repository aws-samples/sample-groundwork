import type { ContextProvider } from "./provider";
import { LocalMockProvider } from "./local-mock-provider";

export type { ContextProvider } from "./provider";
export * from "./types";

export type ContextMode = "mock" | "ontology" | "coa";

/**
 * The mode switch. See docs/RUNNING.md.
 *
 *   mock      (default)  → LocalMockProvider     — Mode 1, npm only
 *   ontology             → LocalOntologyProvider — Mode 2, npm, no AWS
 *   coa                  → CoaProvider           — Mode 3, real COA
 *
 * The active mode is normally `CONTEXT_MODE` at startup, but the UI can switch it
 * live via `setMode()` (POST /api/mode) so a demo can climb the fidelity ladder
 * without restarting the server. Providers are cached per mode so switching back
 * is instant. The UI never learns which mode is active except via `provider.fidelity`.
 */
const _providers: Partial<Record<ContextMode, ContextProvider>> = {};
let _activeMode: ContextMode | null = null;

function normalizeMode(m: string | undefined | null): ContextMode {
  const v = (m ?? "mock").toLowerCase();
  return v === "ontology" || v === "coa" ? v : "mock";
}

/** The currently active mode (runtime override if set, else CONTEXT_MODE, else mock). */
export function getMode(): ContextMode {
  return _activeMode ?? normalizeMode(process.env.CONTEXT_MODE);
}

/**
 * Switch the active mode at runtime. Instantiates the provider (throws if the
 * mode's requirements aren't met, e.g. coa without COA_BASE_URL) so the caller
 * can report a clean error instead of silently staying on the old mode.
 */
export function setMode(mode: ContextMode): ContextProvider {
  const provider = buildProvider(mode); // may throw — caller handles
  _activeMode = mode;
  return provider;
}

function buildProvider(mode: ContextMode): ContextProvider {
  const cached = _providers[mode];
  if (cached) return cached;

  let provider: ContextProvider;
  switch (mode) {
    case "ontology":
      // Wired in B2. Lazy require keeps the dependency out of Mode 1 bundles.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { LocalOntologyProvider } = require("./local-ontology-provider");
        provider = new LocalOntologyProvider();
      } catch (err) {
        throw new Error(
          `CONTEXT_MODE=ontology is unavailable: ${(err as Error).message}`
        );
      }
      break;
    case "coa":
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { CoaProvider } = require("./coa-provider");
        provider = new CoaProvider(process.env.COA_BASE_URL, process.env.COA_TOKEN);
      } catch (err) {
        throw new Error(
          `CONTEXT_MODE=coa is unavailable: ${(err as Error).message} (set COA_BASE_URL and COA_TOKEN in .env.local)`
        );
      }
      break;
    case "mock":
    default:
      provider = new LocalMockProvider();
      break;
  }

  _providers[mode] = provider;
  return provider;
}

export function getProvider(): ContextProvider {
  return buildProvider(getMode());
}
/**
 * The local demo seed (SQLite), regardless of the active mode. Used where the
 * UI explicitly shows the seed, e.g. the Graph page in Live COA, whose own
 * graph is virtual and cannot be drawn.
 */
export function getSeedProvider(): ContextProvider {
  return buildProvider("mock");
}

/** Test/hot-reload helper — clears cached providers and any runtime override. */
export function resetProvider() {
  for (const k of Object.keys(_providers) as ContextMode[]) delete _providers[k];
  _activeMode = null;
}
