import type { TargetSelection } from "@tsonic/target-api";
import { realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { readRustUserProjectFile } from "./rust-target-options.js";

export type RustUserCargoManifestResolution =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid"; readonly path: string; readonly message: string }
  | { readonly kind: "resolved"; readonly manifestPath: string };

export function resolveRustUserCargoManifest(
  target: TargetSelection,
  projectDirectory: string,
): RustUserCargoManifestResolution {
  const configured = readRustUserProjectFile(target);
  if (configured === undefined) {
    return { kind: "absent" };
  }
  const candidate = isAbsolute(configured)
    ? resolve(configured)
    : resolve(projectDirectory, configured);
  if (basename(candidate) !== "Cargo.toml") {
    return invalid(candidate, `Rust target option 'projectFile' must point to Cargo.toml: ${candidate}`);
  }
  let manifestPath: string;
  try {
    manifestPath = realpathSync(candidate);
  } catch {
    return invalid(candidate, `Rust target option 'projectFile' does not exist: ${candidate}`);
  }
  try {
    if (!statSync(manifestPath).isFile()) {
      return invalid(manifestPath, `Rust target option 'projectFile' must point to a file: ${manifestPath}`);
    }
  } catch {
    return invalid(manifestPath, `Rust target option 'projectFile' cannot be read: ${manifestPath}`);
  }
  return { kind: "resolved", manifestPath };
}

function invalid(path: string, message: string): RustUserCargoManifestResolution {
  return { kind: "invalid", path, message };
}
