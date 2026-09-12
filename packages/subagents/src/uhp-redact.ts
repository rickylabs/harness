/**
 * The publication boundary: what a consumer is allowed to be handed, and the fence that checks it.
 *
 * Issue #286, "Redact `detail` before it crosses the boundary". Run artifacts:
 * `.llm/runs/provider-uhp--e37/`.
 *
 * ## The defect this exists to prevent
 *
 * `describeRouteEvidence` in `route.ts` builds its diagnostic by embedding field values verbatim
 * through `quote()` — every mismatched field on the `mismatch` branch, and **every** field on the
 * `known` branch. `cwd` is one of `ROUTE_FIELDS`, so the string carries an absolute working directory on
 * the success path as well as the failure path. The type says so about itself: `RouteIdentityEvidence.detail`
 * "may contain caller-supplied route strings, including absolute paths, so callers remain responsible
 * for handling it".
 *
 * A human diagnostic documented as unsafe is fine as a human diagnostic. It is not fine as something a
 * provider hands to a consumer that will project it into a durable stream, and the redaction belongs on
 * the producing side: a consumer parsing a free-form string it has no grammar for is guessing.
 *
 * ## Two functions that must not call each other
 *
 * `redactPaths` rewrites; `pathShapedStrings` finds. They share `PATH_SHAPES` and nothing else, on
 * purpose. If the fence called the redactor, a mutation that disabled redaction would disable the fence
 * with it, and the test asserting "nothing published carries a path" would keep passing while the leak
 * was live. The consuming side made the same choice for the same reason
 * (`rickylabs/atelier-cockpit`'s `assertSanitized`, as corrected on #286): its value check and its
 * redaction share a pattern list and neither invokes the other.
 *
 * The fence is a value check over **every** string at any depth under any key, not a forbidden-key
 * check. A key-name fence does not fire on a path embedded in a free-form `detail`, which is exactly the
 * shape this module is about.
 *
 * ## What is redacted, and what is deliberately not
 *
 * Paths only. Model ids, effort rungs, harness words, `chrn_` console ids, response ids and session ids
 * stay verbatim: they are the identifiers a reader needs, none of them is a secret, and a redaction that
 * removes everything is one an operator learns to route around. Credentials never reach here at all —
 * `uhp-transport.ts` owns the profile and the bearer header, and no verdict this package builds has a
 * value from either.
 */

import {
  ROUTE_FIELDS,
  describeRouteEvidence,
  isRouteEvidenceVerified,
  type RouteField,
  type RouteIdentityEvidence,
  type RouteIdentityValues,
  type RouteValueEvidence,
} from "./route.js";

/* -------------------------------------------------------------------------------------------------
 * The shapes
 * ---------------------------------------------------------------------------------------------- */

/**
 * What a path looks like, in the four shapes that reach a diagnostic here.
 *
 * POSIX absolute paths require two or more segments. One segment (`/v1`) is a protocol route or a bare
 * name and carries nothing about a filesystem; two (`/home/agent`) is a location on a machine. The
 * boundary is drawn deliberately rather than left at "anything with a slash", because a fence that fires
 * on every URL path is a fence somebody switches off.
 */
export const PATH_SHAPES: readonly RegExp[] = [
  /** POSIX absolute, two segments or more. */
  /(?:\/[A-Za-z0-9._~%+-]+){2,}\/?/g,
  /** A Windows drive path, either slash. */
  /[A-Za-z]:[\\/][A-Za-z0-9._~%+\-\\/]*/g,
  /** A UNC share. */
  /\\\\[A-Za-z0-9._~%+\-\\/]+/g,
  /** A `file://` URL, which is a path wearing a scheme. */
  /file:\/\/\S+/g,
  /** A home-relative path. `~` alone is not one. */
  /~\/[A-Za-z0-9._~%+\-/]+/g,
];

/** What replaces a path in a published diagnostic. Never the path, never a hash of it. */
export const REDACTED_PATH = "<path redacted>" as const;

/** What replaces a `cwd` value in published evidence: presence, and nothing else. */
export const CWD_PRESENT = "<cwd present>" as const;

/** The marker a published route carries so a boundary check can tell it has been through here. */
export const CWD_REDUCED_TO_PRESENCE = "cwd-reduced-to-presence" as const;

/**
 * Blank out `http(s)` URLs before scanning or rewriting, so their paths are neither reported nor
 * mangled.
 *
 * An HTTPS URL is not a filesystem path and a router's base URL appearing in a diagnostic is useful. The
 * replacement is the same length as what it replaces, so indices in the scanned string still line up with
 * the original.
 */
function maskUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, (match) => " ".repeat(match.length));
}

/**
 * Every path-shaped string inside a value, at any depth, under any key. The fence.
 *
 * Written as a finder rather than an assertion so a test can print what it found, and so the provider can
 * run it on its own published result as a last line of defence. It walks arrays, plain objects and the
 * string values inside them; a non-string leaf cannot carry a path and is not reported.
 *
 * It does not call `redactPaths`, and it must never be changed to.
 */
export function pathShapedStrings(value: unknown, at = "$"): readonly string[] {
  if (typeof value === "string") {
    const scanned = maskUrls(value);
    const found: string[] = [];
    for (const shape of PATH_SHAPES) {
      // A fresh regex per call: a shared global regex carries `lastIndex` between calls.
      const matcher = new RegExp(shape.source, shape.flags);
      for (const match of scanned.matchAll(matcher)) {
        if (match[0].length > 0) found.push(`${at}: ${match[0]}`);
      }
    }
    return found;
  }
  if (Array.isArray(value)) {
    return value.flatMap((element, index) => pathShapedStrings(element, `${at}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, element]) =>
      pathShapedStrings(element, `${at}.${key}`)
    );
  }
  return [];
}

/**
 * Rewrite every path-shaped token in a diagnostic string.
 *
 * The rewriter, and the half a mutation is most likely to be aimed at. It does not call
 * `pathShapedStrings`, and it must never be changed to.
 */
export function redactPaths(text: string): string {
  const masked = maskUrls(text);
  const spans: { start: number; end: number }[] = [];
  for (const shape of PATH_SHAPES) {
    const matcher = new RegExp(shape.source, shape.flags);
    for (const match of masked.matchAll(matcher)) {
      if (match.index === undefined || match[0].length === 0) continue;
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  spans.sort((a, b) => a.start - b.start);

  // Overlapping spans are **merged**, not skipped. The shapes overlap by design — `/a/b:/c/d` is a POSIX
  // match ending at the colon and a drive-letter match beginning before it — and skipping the second span
  // because it started inside the first would leave its tail in the output. The fence would then catch the
  // remainder and the whole diagnostic would be withheld: fail-closed, but a diagnostic lost to an
  // off-by-one rather than to a real leak.
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
      continue;
    }
    merged.push({ ...span });
  }

  let redacted = "";
  let cursor = 0;
  for (const span of merged) {
    redacted += text.slice(cursor, span.start) + REDACTED_PATH;
    cursor = span.end;
  }
  return redacted + text.slice(cursor);
}

/* -------------------------------------------------------------------------------------------------
 * Route evidence, published
 * ---------------------------------------------------------------------------------------------- */

/**
 * Route evidence in the only form this provider hands to a consumer.
 *
 * Structurally a `RouteIdentityEvidence`, so `isRouteEvidenceVerified` and every existing consumer keep
 * working, plus one marker field. `status`, `mismatches` and `invalid` are carried through **unchanged**:
 * they are the three facts that keep `mismatch`, `unknown` and `known` distinct, and a redaction that
 * blurred them would trade one leak for the collapse #286 spends three sections on.
 */
export interface PublishedRouteEvidence extends RouteIdentityEvidence {
  readonly redaction: typeof CWD_REDUCED_TO_PRESENCE;
  /**
   * `isRouteEvidenceVerified` of the **unredacted** evidence, carried because redaction makes it
   * unrecomputable.
   *
   * The predicate compares `requested` and `observed` values and requires an absolute `cwd`; reducing
   * `cwd` to presence therefore makes it answer `false` for any route, including one that was fully
   * verified. That direction is safe — a consumer that re-derives it fails closed — but it is also
   * permanent, and #286 names the failure it would become: "A branch that encodes 'provider is uhp,
   * therefore unverified' keeps working today and silently never accepts a `known` after S10 widens
   * `RouteSource`." A field computed before redaction is not that branch. It is the fact, measured where
   * the values still exist, so the day a UHP route can be verified this reports it.
   *
   * Read this, not a re-derivation. `false` here is authoritative; `false` from the predicate on published
   * evidence may only mean the `cwd` was redacted.
   */
  readonly verifiedBeforeRedaction: boolean;
}

function redactValue(field: RouteField, item: RouteValueEvidence): RouteValueEvidence {
  if (field !== "cwd" || item.value === null) return item;
  return { value: CWD_PRESENT, source: item.source };
}

function redactSide(values: RouteIdentityValues): RouteIdentityValues {
  return {
    provider: redactValue("provider", values.provider),
    model: redactValue("model", values.model),
    effort: redactValue("effort", values.effort),
    cwd: redactValue("cwd", values.cwd),
  };
}

/**
 * Reduce `cwd` to presence and rebuild the diagnostic from the reduced values.
 *
 * The detail is **regenerated** by `describeRouteEvidence` over the redacted values rather than
 * string-scrubbed after the fact. That is the difference between "we removed the paths we thought of"
 * and "the describer never saw a path": same describer, same three branches, same wording for `known`,
 * `mismatch` and `unknown`, with nothing to scrub. `redactPaths` then exists for the prose this module
 * does not generate — a verdict sentence a provider composes itself.
 *
 * `status`, `mismatches` and `invalid` are preserved exactly, so a substitution still reads as a
 * substitution after publication.
 */
export function redactRouteEvidence(evidence: RouteIdentityEvidence): PublishedRouteEvidence {
  const partial = {
    status: evidence.status,
    requested: redactSide(evidence.requested),
    observed: redactSide(evidence.observed),
    mismatches: [...evidence.mismatches],
    invalid: evidence.invalid.map((entry) => ({ side: entry.side, field: entry.field })),
  };
  return {
    ...partial,
    detail: redactPaths(describeRouteEvidence(partial)),
    redaction: CWD_REDUCED_TO_PRESENCE,
    // Measured on the evidence as it arrived, before `cwd` was reduced. See the field's own comment for
    // why re-deriving it downstream would answer `false` forever.
    verifiedBeforeRedaction: isRouteEvidenceVerified(evidence),
  };
}

/**
 * Whether a value is evidence that has been through `redactRouteEvidence`.
 *
 * The marker is checked, and so is the thing the marker claims: a `cwd` value that still looks like a
 * path fails even when the marker is present. A flag that can be set without doing the work is a flag
 * that will be.
 */
export function isRedactedRouteEvidence(value: unknown): value is PublishedRouteEvidence {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PublishedRouteEvidence>;
  if (candidate.redaction !== CWD_REDUCED_TO_PRESENCE) return false;
  for (const side of [candidate.requested, candidate.observed]) {
    const cwd = side?.cwd?.value;
    if (cwd !== null && cwd !== undefined && cwd !== CWD_PRESENT) return false;
  }
  return ROUTE_FIELDS.every((field) =>
    pathShapedStrings(candidate.requested?.[field]?.value ?? null).length === 0 &&
    pathShapedStrings(candidate.observed?.[field]?.value ?? null).length === 0
  ) && pathShapedStrings(candidate.detail ?? null).length === 0;
}
