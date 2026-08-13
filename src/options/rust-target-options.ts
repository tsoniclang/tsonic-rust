import type {
  TargetSelection,
  TargetTypescriptCompatibilityMode,
} from "@tsonic/target-api";

export type RustOutputType = "lib" | "bin";

export type RustEdition = "2021" | "2024";

const supportedRustTargetOptionKeys = Object.freeze([
  "crateName",
  "edition",
  "outputType",
  "projectFile",
  "typescriptCompatibility",
]);

const crateNamePattern = /^[a-z][a-z0-9_]*$/u;

export function validateRustTargetOptions(target: TargetSelection): void {
  const options = target.options;
  if (options === undefined) {
    return;
  }
  const allowedKeys = new Set(supportedRustTargetOptionKeys);
  for (const key of Object.keys(options)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Rust target option 'options.${key}' is not supported.`);
    }
  }
  readRustCrateName(target);
  readRustEdition(target);
  readRustOutputType(target);
  readRustUserProjectFile(target);
  readRustTypescriptCompatibilityMode(target);
}

export function readRustCrateName(target: TargetSelection): string {
  const value = readOptionalStringOption(target, "crateName");
  if (value === undefined) {
    return "tsonic_generated";
  }
  if (!crateNamePattern.test(value)) {
    throw new Error(`Rust target option 'crateName' must match ${crateNamePattern.source}; use lowercase ASCII letters, digits, and underscores.`);
  }
  return value;
}

export function readRustEdition(target: TargetSelection): RustEdition {
  const value = readOptionalStringOption(target, "edition");
  if (value === undefined) {
    return "2021";
  }
  if (value !== "2021" && value !== "2024") {
    throw new Error("Rust target option 'edition' must be either '2021' or '2024'.");
  }
  return value;
}

export function readRustOutputType(target: TargetSelection): RustOutputType {
  const value = readOptionalStringOption(target, "outputType");
  if (value === undefined) {
    return "lib";
  }
  if (value !== "lib" && value !== "bin") {
    throw new Error("Rust target option 'outputType' must be either 'lib' or 'bin'.");
  }
  return value;
}

export function readRustUserProjectFile(target: TargetSelection): string | undefined {
  return readOptionalStringOption(target, "projectFile");
}

export function readRustTypescriptCompatibilityMode(target: TargetSelection): TargetTypescriptCompatibilityMode {
  const value = target.options?.typescriptCompatibility;
  if (value === undefined) {
    return "strict-native";
  }
  if (value !== "strict-native" && value !== "compat") {
    throw new Error("Rust target option 'typescriptCompatibility' must be either 'strict-native' or 'compat'.");
  }
  return value;
}

function readOptionalStringOption(target: TargetSelection, key: string): string | undefined {
  const value = target.options?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Rust target option '${key}' must be a non-empty string.`);
  }
  return value;
}
