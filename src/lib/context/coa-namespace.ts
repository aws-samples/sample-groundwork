import { VERTICAL_TO_PACK } from "./pack-loader";
import { verticals } from "../../data/verticals";

/**
 * One rule for which COA namespace a vertical resolves to, shared by the
 * provider (query/schema/metrics), the Sources service and the routes.
 *
 *   env COA_NAMESPACE_<VERTICAL_ID_UPPERCASE> (e.g. COA_NAMESPACE_OTSEC)
 *     → that value, and the vertical counts as Live-COA-configured.
 *   unset → the pack directory name (VERTICAL_TO_PACK), else the vertical id,
 *     exactly as CoaProvider resolved it before; not configured.
 *
 * `COA_NAMESPACE_MANUFACTURING` keeps working for the `manufacturing` id.
 * The namespace value is never returned to the browser: callers expose the
 * `configured` flag and vertical ids only.
 */
export function coaNamespace(vertical: string): { id: string; configured: boolean } {
  const envKey = `COA_NAMESPACE_${vertical.toUpperCase()}`;
  const value = process.env[envKey];
  return { id: value || VERTICAL_TO_PACK[vertical] || vertical, configured: Boolean(value) };
}

/** The UI vertical ids whose COA namespace env var is set. */
export function configuredCoaVerticals(): string[] {
  return Object.keys(verticals).filter((v) => coaNamespace(v).configured);
}
