/** One run directory's files, addressed by artifact name. */
export interface RunDirectory {
  /** The file's text; rejects when it cannot be read. */
  readText(name: string): Promise<string>;
  /** The file's text, or undefined when it does not exist; rejects on any other read failure. */
  readTextIfPresent(name: string): Promise<string | undefined>;
  writeText(name: string, text: string): Promise<void>;
  /** Where the named file lives, for operator messages. */
  locate(name: string): string;
}
