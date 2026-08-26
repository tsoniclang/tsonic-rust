import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  RustCompilerDependency,
  RustCompilerProjectSnapshot,
  RustCompilerStandardLibrarySnapshot,
} from "../model/model.js";
import {
  rustCompilerProviderProtocolVersion,
  supportedRustdocFormatVersion,
} from "../model/model.js";
import { verifyRustCompilerStandardLibraryMetadata } from "./cargo-snapshot.js";
import {
  isRecord,
  parseRustdocDocument,
  type RustdocDocument,
} from "../model/rustdoc-schema.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";

const commandBufferLimit = 64 * 1024 * 1024;
const rustdocJsonByteLimit = 128 * 1024 * 1024;
const rustdocTimeoutMilliseconds = 540_000;

interface RustdocArtifactMarker {
  readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
  readonly projectDigest: string;
  readonly dependencyAlias: string;
  readonly dependencySourceDigest: string;
  readonly compilerIdentity: string;
  readonly outputDigest: string;
}

export function loadRustdocDocument(options: {
  readonly snapshot: RustCompilerProjectSnapshot;
  readonly dependency: RustCompilerDependency;
  readonly targetDirectory: string;
}): RustdocDocument {
  const outputPath = rustdocOutputPath(options);
  const markerPath = `${outputPath}.tsonic-provider.json`;
  const cached = readCachedRustdocDocument(options, outputPath, markerPath);
  if (cached !== undefined) {
    return cached;
  }
  if (options.snapshot.kind === "standard-library") {
    return generateStandardLibraryRustdoc({
      snapshot: options.snapshot,
      dependency: options.dependency,
      targetDirectory: options.targetDirectory,
    }, outputPath, markerPath);
  }
  const args = [
    "rustdoc",
    "--manifest-path",
    options.snapshot.manifestPath,
    "--package",
    options.dependency.packageId,
    "--lib",
    "--target-dir",
    options.targetDirectory,
    "--",
    "-Z",
    "unstable-options",
    "--output-format",
    "json",
  ];
  const result = spawnSync("cargo", args, {
    cwd: options.dependency.sourceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      RUSTC_BOOTSTRAP: "1",
      CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
    },
    maxBuffer: commandBufferLimit,
    timeout: rustdocTimeoutMilliseconds,
    killSignal: "SIGKILL",
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`cargo ${args.join(" ")} failed (${String(result.status)}): ${result.stderr.trim()}`);
  }
  const outputText = readBoundedRustdocOutput(outputPath);
  const parsed = parseRustdocDocument(outputText, options.dependency);
  writeRustdocArtifactMarker(options, markerPath, outputText);
  return parsed;
}

function generateStandardLibraryRustdoc(
  options: {
    readonly snapshot: RustCompilerStandardLibrarySnapshot;
    readonly dependency: RustCompilerDependency;
    readonly targetDirectory: string;
  },
  outputPath: string,
  markerPath: string,
): RustdocDocument {
  verifyRustCompilerStandardLibraryMetadata(options.snapshot);
  mkdirSync(dirname(outputPath), { recursive: true });
  const args = [
    "rustdoc",
    "--manifest-path",
    options.snapshot.manifestPath,
    "--package",
    options.dependency.packageId,
    "--locked",
    "--offline",
    "--lib",
    "--target",
    options.snapshot.targetTriple,
    "--target-dir",
    options.targetDirectory,
    "--",
    "-Z",
    "unstable-options",
    "--output-format",
    "json",
  ];
  const result = spawnSync("cargo", args, {
    cwd: options.dependency.sourceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      RUSTC_BOOTSTRAP: "1",
      CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
    },
    maxBuffer: commandBufferLimit,
    timeout: rustdocTimeoutMilliseconds,
    killSignal: "SIGKILL",
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`cargo ${args.join(" ")} failed (${String(result.status)}): ${result.stderr.trim()}`);
  }
  verifyRustCompilerStandardLibraryMetadata(options.snapshot);
  const outputText = readBoundedRustdocOutput(outputPath);
  const parsed = parseRustdocDocument(outputText, options.dependency);
  writeRustdocArtifactMarker(options, markerPath, outputText);
  return parsed;
}

function writeRustdocArtifactMarker(
  options: {
    readonly snapshot: RustCompilerProjectSnapshot;
    readonly dependency: RustCompilerDependency;
  },
  markerPath: string,
  outputText: string,
): void {
  writeJsonAtomically(markerPath, {
    protocolVersion: rustCompilerProviderProtocolVersion,
    projectDigest: options.snapshot.digest,
    dependencyAlias: options.dependency.alias,
    dependencySourceDigest: options.dependency.sourceDigest,
    compilerIdentity: options.snapshot.compiler.rustcVerboseVersion,
    outputDigest: digestText(outputText),
  } satisfies RustdocArtifactMarker);
}

function readCachedRustdocDocument(
  options: {
    readonly snapshot: RustCompilerProjectSnapshot;
    readonly dependency: RustCompilerDependency;
  },
  outputPath: string,
  markerPath: string,
): RustdocDocument | undefined {
  if (!existsSync(outputPath) || !existsSync(markerPath)) {
    return undefined;
  }
  let marker: unknown;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(marker) ||
    marker.protocolVersion !== rustCompilerProviderProtocolVersion ||
    marker.projectDigest !== options.snapshot.digest ||
    marker.dependencyAlias !== options.dependency.alias ||
    marker.dependencySourceDigest !== options.dependency.sourceDigest ||
    marker.compilerIdentity !== options.snapshot.compiler.rustcVerboseVersion ||
    typeof marker.outputDigest !== "string") {
    return undefined;
  }
  const outputText = readBoundedRustdocOutput(outputPath);
  if (digestText(outputText) !== marker.outputDigest) {
    return undefined;
  }
  try {
    return parseRustdocDocument(outputText, options.dependency);
  } catch {
    return undefined;
  }
}

function rustdocOutputPath(options: {
  readonly snapshot: RustCompilerProjectSnapshot;
  readonly dependency: RustCompilerDependency;
  readonly targetDirectory: string;
}): string {
  return join(
    options.targetDirectory,
    ...(options.snapshot.kind === "standard-library" ? [options.snapshot.targetTriple] : []),
    "doc",
    `${options.dependency.crateName.replace(/-/gu, "_")}.json`,
  );
}

function readBoundedRustdocOutput(path: string): string {
  const size = statSync(path).size;
  if (!Number.isSafeInteger(size) || size < 0 || size > rustdocJsonByteLimit) {
    throw new Error(`rustdoc JSON '${path}' exceeds the ${rustdocJsonByteLimit}-byte compiler-provider limit.`);
  }
  return readFileSync(path, "utf8");
}

function writeJsonAtomically(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value));
  renameSync(temporaryPath, path);
}

export function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function validateDependencyBelongsToSnapshot(
  snapshot: RustCompilerProjectSnapshot,
  dependency: RustCompilerDependency,
): void {
  if (snapshot.protocolVersion !== rustCompilerProviderProtocolVersion ||
    snapshot.compiler.rustdocFormatVersion !== supportedRustdocFormatVersion) {
    throw new Error(`Rust compiler-provider snapshot uses an unsupported contract.`);
  }
  const exact = snapshot.dependencies.find((candidate) => candidate.alias === dependency.alias);
  if (exact === undefined || !closedMetadataEquals(exact, dependency)) {
    throw new Error(`Rust compiler-provider dependency '${dependency.alias}' does not belong to snapshot '${snapshot.digest}'.`);
  }
}
