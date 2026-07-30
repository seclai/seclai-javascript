/**
 * Dated API versions known to this release, for use with the `apiVersion`
 * client option.
 *
 * The set is open: the API adds versions without an SDK release, and
 * {@link ApiVersion} widens to `string`, so a date newer than this release
 * knows about can be passed directly. Treat these as convenience constants
 * rather than an exhaustive list — `getApiVersion()` reports what the server
 * actually supports.
 */
export const SeclaiApiVersion = {
  V2026_07_01: "2026-07-01",
  V2026_07_27: "2026-07-27",
  /** Baseline applied to an unpinned, header-less caller. */
  Default: "2026-07-01",
  /** Newest version known to this SDK release. May lag the server. */
  Latest: "2026-07-27",
} as const;

/**
 * A dated API version. Known values autocomplete; any `YYYY-MM-DD` string still
 * typechecks, but one this release was not built against is rejected at
 * construction unless `allowUnknownApiVersion` is set.
 */
export type ApiVersion =
  | (typeof SeclaiApiVersion)[keyof typeof SeclaiApiVersion]
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/** Every version this release was built against, oldest first. */
export const KNOWN_API_VERSIONS: readonly string[] = Object.entries(SeclaiApiVersion)
  .filter(([k]) => k.startsWith("V"))
  .map(([, v]) => v);
