import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import type {
  TargetArtifact,
  TargetCompileOutput,
  TargetSourceFile,
} from "@tsonic/target-api/artifacts";
import type { RustOutputPlan } from "../artifact-model/output.js";

const rustfmtBatchSize = 128;
const rustfmtBatchPathBytes = 64 * 1024;
const rustfmtOutputLimit = 1024 * 1024;
const rustfmtDiagnosticLimit = 64 * 1024;
const rustfmtTimeoutMilliseconds = 120_000;

export class RustFormattingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RustFormattingError";
  }
}

export function formatRustCompileOutput(
  output: TargetCompileOutput,
  edition: RustOutputPlan["edition"],
): TargetCompileOutput {
  const sources = output.artifacts.filter(isRustSourceFile);
  if (sources.length === 0) {
    return output;
  }

  let stageRoot: string;
  try {
    stageRoot = mkdtempSync(resolve(tmpdir(), "tsonic-rustfmt-"));
  } catch (error) {
    throw formattingError("Unable to create the Rust formatter staging directory", error);
  }

  let formattedOutput: TargetCompileOutput | undefined;
  let failure: RustFormattingError | undefined;
  try {
    const stagedSources = prepareRustSources(stageRoot, sources);
    for (const batch of createRustfmtBatches(stagedSources)) {
      runRustfmt(stageRoot, edition, batch.map((source) => source.relativePath));
    }
    const formattedByPath = new Map(stagedSources.map((source) => [
      source.artifactPath,
      readFileSync(source.absolutePath, "utf8"),
    ]));
    formattedOutput = Object.freeze({
      artifacts: Object.freeze(output.artifacts.map((artifact): TargetArtifact => {
        if (!isRustSourceFile(artifact)) {
          return artifact;
        }
        const formatted = formattedByPath.get(artifact.path);
        return formatted === undefined
          ? artifact
          : Object.freeze({ ...artifact, text: formatted });
      })),
    });
  } catch (error) {
    failure = error instanceof RustFormattingError
      ? error
      : formattingError("Unable to stage or read generated Rust source", error);
  }

  try {
    rmSync(stageRoot, { recursive: true, force: true });
  } catch (error) {
    const cleanupFailure = formattingError(
      "Unable to remove the Rust formatter staging directory",
      error,
    );
    failure = failure === undefined
      ? cleanupFailure
      : new RustFormattingError(`${failure.message}\n${cleanupFailure.message}`);
  }
  if (failure !== undefined) {
    throw failure;
  }
  return formattedOutput!;
}

interface StagedRustSource {
  readonly artifactPath: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly text: string;
}

function prepareRustSources(
  stageRoot: string,
  sources: readonly TargetSourceFile[],
): readonly StagedRustSource[] {
  const stagedSources = sources.map((source) => locateRustSource(stageRoot, source));
  const paths = new Set<string>();
  for (const source of stagedSources) {
    if (paths.has(source.relativePath)) {
      throw new RustFormattingError(
        `Generated Rust source path '${source.relativePath}' occurs more than once.`,
      );
    }
    paths.add(source.relativePath);
  }
  for (const source of stagedSources) {
    let separator = source.relativePath.indexOf("/");
    while (separator >= 0) {
      const ancestor = source.relativePath.slice(0, separator);
      if (paths.has(ancestor)) {
        throw new RustFormattingError(
          `Generated Rust source paths '${ancestor}' and '${source.relativePath}' conflict as a file and directory.`,
        );
      }
      separator = source.relativePath.indexOf("/", separator + 1);
    }
  }
  for (const source of stagedSources) {
    mkdirSync(dirname(source.absolutePath), { recursive: true });
    writeFileSync(source.absolutePath, source.text, "utf8");
  }
  return Object.freeze(stagedSources);
}

function locateRustSource(
  stageRoot: string,
  source: TargetSourceFile,
): StagedRustSource {
  if (isAbsolute(source.path) || source.path.includes("\0")) {
    throw new RustFormattingError(
      `Generated Rust source path '${source.path}' is not a safe relative artifact path.`,
    );
  }
  const absolutePath = resolve(stageRoot, source.path);
  const relativePath = relative(stageRoot, absolutePath).split("\\").join("/");
  if (relativePath.length === 0 || relativePath === ".." || relativePath.startsWith("../")) {
    throw new RustFormattingError(
      `Generated Rust source path '${source.path}' escapes the formatter staging root.`,
    );
  }
  return Object.freeze({
    artifactPath: source.path,
    relativePath,
    absolutePath,
    text: source.text,
  });
}

function createRustfmtBatches(
  sources: readonly StagedRustSource[],
): readonly (readonly StagedRustSource[])[] {
  const batches: StagedRustSource[][] = [];
  let batch: StagedRustSource[] = [];
  let pathBytes = 0;
  for (const source of sources) {
    const sourcePathBytes = Buffer.byteLength(source.relativePath, "utf8") + 1;
    if (sourcePathBytes > rustfmtBatchPathBytes) {
      throw new RustFormattingError(
        `Generated Rust source path '${source.artifactPath}' exceeds the formatter command limit.`,
      );
    }
    if (batch.length === rustfmtBatchSize || pathBytes + sourcePathBytes > rustfmtBatchPathBytes) {
      batches.push(batch);
      batch = [];
      pathBytes = 0;
    }
    batch.push(source);
    pathBytes += sourcePathBytes;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return Object.freeze(batches.map((entry) => Object.freeze(entry)));
}

function runRustfmt(
  stageRoot: string,
  edition: RustOutputPlan["edition"],
  sourcePaths: readonly string[],
): void {
  const executable = process.env.RUSTFMT?.trim() || "rustfmt";
  const result = spawnSync(executable, [
    "--edition",
    edition,
    "--style-edition",
    edition,
    "--emit",
    "files",
    "--config",
    "skip_children=true",
    "--",
    ...sourcePaths,
  ], {
    cwd: stageRoot,
    encoding: "utf8",
    maxBuffer: rustfmtOutputLimit,
    timeout: rustfmtTimeoutMilliseconds,
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw new RustFormattingError(
      `Unable to execute Rust formatter '${executable}': ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
      .trim()
      .split(stageRoot).join("<rustfmt-stage>")
      .slice(0, rustfmtDiagnosticLimit);
    throw new RustFormattingError(
      `Rust formatter '${executable}' ${result.status === null
        ? `terminated by signal ${result.signal ?? "unknown"}`
        : `exited with status ${String(result.status)}`}${output.length === 0 ? "." : `:\n${output}`}`,
    );
  }
}

function formattingError(message: string, error: unknown): RustFormattingError {
  const detail = error instanceof Error ? error.message : String(error);
  return new RustFormattingError(`${message}: ${detail}`);
}

function isRustSourceFile(artifact: TargetArtifact): artifact is TargetSourceFile {
  return artifact.kind === "source" &&
    "language" in artifact && artifact.language === "rust";
}
