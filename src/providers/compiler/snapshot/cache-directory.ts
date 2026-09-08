import { closeSync, lstatSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cacheDirectoryTagName = "CACHEDIR.TAG";
const cacheDirectorySignature = Buffer.from("Signature: 8a477f597d28d172789f06886806bc55", "ascii");

export function isDeclaredCacheDirectory(directory: string): boolean {
  const path = join(directory, cacheDirectoryTagName);
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (metadata === undefined || !metadata.isFile() || metadata.size < cacheDirectorySignature.length) {
    return false;
  }
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(cacheDirectorySignature.length);
    const length = readSync(descriptor, header, 0, header.length, 0);
    return length === header.length && header.equals(cacheDirectorySignature);
  } finally {
    closeSync(descriptor);
  }
}

export function createRustCompilerCacheDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(join(directory, cacheDirectoryTagName), `${cacheDirectorySignature.toString("ascii")}\n`, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
    if (!isDeclaredCacheDirectory(directory)) {
      throw new Error(`Rust compiler cache '${directory}' contains an invalid ${cacheDirectoryTagName}.`);
    }
  }
}
