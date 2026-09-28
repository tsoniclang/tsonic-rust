import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RustCompilerMetadataArtifact } from "../model/model.js";

const maximumArtifacts = 1_024;
const maximumBytes = 1_073_741_824;
const readBufferBytes = 65_536;
const artifactName = /^lib([A-Za-z0-9_]+)-[0-9a-f]+\.rmeta$/u;

export function snapshotStandardMetadataArtifacts(
  targetLibraryDirectory: string,
): readonly RustCompilerMetadataArtifact[] {
  const files = readdirSync(targetLibraryDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && artifactName.test(entry.name))
    .map(entry => entry.name)
    .sort();
  if (files.length === 0 || files.length > maximumArtifacts) {
    throw new Error(`Installed Rust target library exposes ${files.length} metadata artifacts; expected 1-${maximumArtifacts}.`);
  }
  let bytes = 0;
  const artifacts = files.map(name => {
    const crateName = artifactName.exec(name)![1]!;
    const path = realpathSync(join(targetLibraryDirectory, name));
    const status = statSync(path);
    if (!status.isFile() || !Number.isSafeInteger(status.size) || status.size < 0 ||
      status.size > maximumBytes - bytes) {
      throw new Error(`Installed Rust target library metadata exceeds its ${maximumBytes}-byte budget or contains an invalid artifact.`);
    }
    bytes += status.size;
    return { crateName, path, status };
  });
  const buffer = Buffer.allocUnsafe(readBufferBytes);
  return Object.freeze(artifacts.map(({ crateName, path, status }): RustCompilerMetadataArtifact => {
    const descriptor = openSync(path, "r");
    const hash = createHash("sha256");
    try {
      const requireUnchanged = (): void => {
        const current = fstatSync(descriptor);
        if (!current.isFile() || current.dev !== status.dev || current.ino !== status.ino ||
          current.size !== status.size || current.mtimeMs !== status.mtimeMs || current.ctimeMs !== status.ctimeMs) {
          throw new Error(`Rust standard-library metadata artifact '${path}' changed while its snapshot was created.`);
        }
      };
      requireUnchanged();
      let remaining = status.size;
      while (remaining > 0) {
        const read = readSync(descriptor, buffer, 0, Math.min(buffer.length, remaining), null);
        if (read === 0) {
          throw new Error(`Rust standard-library metadata artifact '${path}' ended before its declared byte length.`);
        }
        hash.update(buffer.subarray(0, read));
        remaining -= read;
      }
      requireUnchanged();
      return Object.freeze({ crateName, path, byteLength: status.size,
        modifiedMilliseconds: status.mtimeMs, digest: hash.digest("hex") });
    } finally {
      closeSync(descriptor);
    }
  }));
}
