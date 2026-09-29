/** Bounded cumulative native usage. Only numbers and source times cross this seam. */
export const MAX_TOKEN_SAMPLES = 16;
export interface TokenSample { readonly at: string; readonly usedTokens: number }
export interface TokenSamples {
  readonly points: readonly TokenSample[];
  readonly truncated: boolean;
  readonly invalid: boolean;
}

export class TokenSampleCollector {
  private readonly points: TokenSample[] = [];
  private truncated = false;
  private invalid = false;

  observe(at: string | null, input: unknown, output: unknown): void {
    if (this.invalid) return;
    const millis = at !== null && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(at)
      ? Date.parse(at) : NaN;
    if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== at!.slice(0, 19) ||
        typeof input !== "number" || !Number.isSafeInteger(input) || input < 0 ||
        typeof output !== "number" || !Number.isSafeInteger(output) || output < 0 ||
        !Number.isSafeInteger(input + output)) {
      this.invalid = true;
      return;
    }
    const usedTokens = input + output;
    const canonicalAt = new Date(millis).toISOString();
    const previous = this.points.at(-1);
    if (previous && (millis < Date.parse(previous.at) || usedTokens < previous.usedTokens)) {
      this.invalid = true;
      return;
    }
    if (previous?.usedTokens === usedTokens) return;
    if (previous && millis === Date.parse(previous.at)) this.points[this.points.length - 1] = { at: canonicalAt, usedTokens };
    else this.points.push({ at: canonicalAt, usedTokens });
    if (this.points.length > MAX_TOKEN_SAMPLES) {
      this.points.splice(1, 1); // preserve the first point and the latest fifteen
      this.truncated = true;
    }
  }

  snapshot(): TokenSamples {
    return { points: this.invalid ? [] : this.points, truncated: !this.invalid && this.truncated, invalid: this.invalid };
  }
}
