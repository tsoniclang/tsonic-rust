import type { TargetSelection } from "@tsonic/target-api";
import type { RustTargetConfiguration } from "../target-model/configuration/model.js";
import type { RustEdition, RustOutputType } from "../target-model/project/model.js";
import type { RustFoundation } from "../target-model/foundation/model.js";
import { resolveRustProjectConfiguration } from "./rust-user-project.js";

export type { RustTargetConfiguration } from "../target-model/configuration/model.js";
export type { RustEdition, RustOutputType } from "../target-model/project/model.js";
export type { RustFoundation } from "../target-model/foundation/model.js";

const supportedRustTargetOptionKeys = Object.freeze([
  "crateName",
  "edition",
  "foundation",
  "outputType",
  "projectFile",
]);

const crateNamePattern = /^[a-z][a-z0-9_]*$/u;

export function validateRustTargetOptions(target: TargetSelection): void {
  validateRustTargetOptionKeys(target);
  readRustCrateName(target);
  readRustEdition(target);
  readRustFoundation(target);
  readRustOutputType(target);
  readRustUserProjectFile(target);
  validateRustOutputFoundation(target);
}

function validateRustTargetOptionKeys(target: TargetSelection): void {
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
}

export function createRustTargetConfiguration(
  target: TargetSelection,
  projectDirectory: string,
  targetOutputRoot: string,
): RustTargetConfiguration {
  validateRustTargetOptionKeys(target);
  validateRustOutputFoundation(target);
  return Object.freeze({
    crateName: readRustCrateName(target),
    edition: readRustEdition(target),
    foundation: readRustFoundation(target),
    outputType: readRustOutputType(target),
    project: resolveRustProjectConfiguration(
      readRustUserProjectFile(target),
      projectDirectory,
      targetOutputRoot,
    ),
  });
}

function validateRustOutputFoundation(target: TargetSelection): void {
  const foundation = readRustFoundation(target);
  if (foundation !== "std" && readRustOutputType(target) === "bin") {
    throw new Error(
      "Rust 'core' and 'alloc' foundations require library output; executable startup remains owned by an explicit native Rust project.",
    );
  }
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

export function readRustFoundation(target: TargetSelection): RustFoundation {
  const value = readOptionalStringOption(target, "foundation");
  if (value === undefined) {
    return "std";
  }
  if (value !== "core" && value !== "alloc" && value !== "std") {
    throw new Error("Rust target option 'foundation' must be 'core', 'alloc', or 'std'.");
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
