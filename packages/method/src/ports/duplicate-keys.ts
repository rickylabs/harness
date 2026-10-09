/** Semantic duplicate-key detection for text that already parsed as JSON. */
export type DuplicateKeyVerdict = "ok" | "duplicate-key" | "unsupported-json";
export type DuplicateKeyCheck = (text: string) => DuplicateKeyVerdict;
