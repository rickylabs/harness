/** Syntax, never a model catalog. Align with Orchid's native provider/model grammar. */
export const openCodeProvider = (value: unknown): value is string => typeof value === "string" &&
  /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
export function openCodeModelSyntax(value: unknown, provider: unknown): value is string {
  if (!openCodeProvider(provider) || typeof value !== "string") return false;
  const slash = value.indexOf("/");
  const leaf = slash < 0 ? value : value.slice(slash + 1);
  return (slash < 0 || value.slice(0, slash) === provider) && /^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(leaf);
}
/** Public metadata keeps private-path/secret controls separate from native admission syntax. */
export function publicOpenCodeModel(value: unknown, provider: unknown): value is string {
  if (!openCodeModelSyntax(value, provider)) return false;
  const leaf = value.startsWith(provider + "/") ? value.slice((provider as string).length + 1) : value;
  return !/(?:^|\/)(?:home|users|tmp|data|config|root|etc|var|private|run|mnt|opt)(?:\/|$)/i.test(leaf) &&
    !/(?:secret|password|credential|bearer|api.?key|github_pat_|gh[pousr]_|\bsk-[A-Za-z0-9]{12,})/i.test(value) &&
    !value.includes("..");
}
