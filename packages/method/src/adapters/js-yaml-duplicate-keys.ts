import { JSON_SCHEMA, load } from "js-yaml";
import type { DuplicateKeyCheck } from "../ports/duplicate-keys.ts";

/** The existing YAML reader supplies semantic duplicate-key detection only; JSON.parse runs first. */
export const jsYamlDuplicateKeys: DuplicateKeyCheck = (text) => {
  try {
    load(text, { schema: JSON_SCHEMA, json: false });
    return "ok";
  } catch (error) {
    const reason = typeof error === "object" && error !== null ? (error as { reason?: unknown }).reason : undefined;
    return reason === "duplicated mapping key" ? "duplicate-key" : "unsupported-json";
  }
};
