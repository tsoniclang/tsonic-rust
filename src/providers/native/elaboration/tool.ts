import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RustLexicalTokenTree } from "../../../target-model/syntax/token-tree.js";
import { decodeNativeTokenResponse } from "./tokens.js";
import { decodeNativeEvidence } from "./decode-evidence.js";
import type { RustNativeEvidence } from "./evidence.js";
import { validateRustNativeEvidenceInputs } from "./freshness.js";

export interface RustNativeSourceLimits {
  readonly maximumRows: number;
  readonly maximumDepth: number;
  readonly maximumOutputBytes: number;
  readonly timeoutMilliseconds: number;
}

export const defaultRustNativeSourceLimits: RustNativeSourceLimits = Object.freeze({
  maximumRows: 1_048_576,
  maximumDepth: 256,
  maximumOutputBytes: 64 * 1024 * 1024,
  timeoutMilliseconds: 120_000,
});

export interface RustNativeSourceTool {
  readonly compilerIdentity: string;
  readonly sysroot: string;
  tokens(source: string, edition: string): readonly RustLexicalTokenTree[];
  check(arguments_: readonly string[]): RustNativeEvidence;
}

export function createRustNativeSourceTool(options: {
  readonly cacheRoot: string;
  readonly compiler?: string;
  readonly limits?: RustNativeSourceLimits;
}): RustNativeSourceTool {
  const limits = Object.freeze({ ...(options.limits ?? defaultRustNativeSourceLimits) });
  validateLimits(limits);
  const compiler = options.compiler ?? process.env.RUSTC ?? "rustc";
  const cacheRoot = resolve(options.cacheRoot);
  mkdirSync(cacheRoot, { recursive: true });
  const command = (executable: string, arguments_: readonly string[], env: NodeJS.ProcessEnv): string => {
    const result = spawnSync(executable, arguments_, {
      cwd: cacheRoot,
      env,
      encoding: "utf8",
      timeout: limits.timeoutMilliseconds,
      maxBuffer: 8 * 1024 * 1024,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    if (result.error !== undefined || result.status !== 0) {
      throw new Error(`Native Rust source service failed: ${result.error?.message ?? result.stderr.trim() ?? String(result.status)}`);
    }
    return result.stdout.trim();
  };
  const compilerIdentity = command(compiler, ["-vV"], process.env);
  const sysroot = command(compiler, ["--print", "sysroot"], process.env);
  const host = compilerIdentity.split("\n").find(line => line.startsWith("host: "))?.slice(6);
  if (host === undefined || !/^[A-Za-z0-9_-]+$/u.test(host) || !existsSync(sysroot)) {
    throw new Error("Selected Rust compiler did not provide its host and sysroot identity.");
  }
  const sourceRoot = fileURLToPath(new URL("../../../../tools/rust-source-provider/src/", import.meta.url));
  const sourceFiles = ["main.rs", "request.rs", "tokens.rs", "source.rs", "definitions.rs", "inputs.rs", "evidence.rs", "effects.rs"];
  const hash = createHash("sha256").update(compilerIdentity).update(sysroot);
  for (const file of sourceFiles) hash.update(file).update(readFileSync(join(sourceRoot, file)));
  const binaryRoot = join(cacheRoot, "tool", hash.digest("hex"));
  const binary = join(binaryRoot, process.platform === "win32" ? "rust-source-provider.exe" : "rust-source-provider");
  let built = false;
  const ensureBuilt = (): void => {
    if (built) return;
    mkdirSync(binaryRoot, { recursive: true });
    if (!existsSync(binary)) {
      const temporary = `${binary}.${process.pid}-${randomUUID()}`;
      command(compiler, [
        "--edition=2024", "--crate-name", "tsonic_rust_source_provider", "-D", "warnings",
        "-L", `native=${join(sysroot, "lib")}`, "-C", "prefer-dynamic", "-C", "codegen-units=1",
        join(sourceRoot, "main.rs"), "-o", temporary,
      ], { ...process.env, RUSTC_BOOTSTRAP: "1" });
      renameSync(temporary, binary);
    }
    built = true;
  };
  const environment = (): NodeJS.ProcessEnv => {
    const libraries = [join(sysroot, "lib"), join(sysroot, "lib", "rustlib", host, "lib")];
    const variable = process.platform === "win32" ? "PATH" : process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
    return { ...process.env, [variable]: [...libraries, process.env[variable]].filter(Boolean).join(delimiter) };
  };
  const request = (payload: Readonly<Record<string, unknown>>): unknown => {
    ensureBuilt();
    const identity = `${process.pid}-${randomUUID()}`;
    const requestPath = join(cacheRoot, "requests", `${identity}.json`);
    const responsePath = join(cacheRoot, "responses", `${identity}.json`);
    mkdirSync(dirname(requestPath), { recursive: true });
    mkdirSync(dirname(responsePath), { recursive: true });
    const text = JSON.stringify({ protocolVersion: 1, ...payload, limits: {
      maximumRows: limits.maximumRows,
      maximumDepth: limits.maximumDepth,
      maximumOutputBytes: limits.maximumOutputBytes,
    } });
    if (Buffer.byteLength(text, "utf8") > 64 * 1024 * 1024) {
      throw new Error("Native Rust source request exceeds the byte limit.");
    }
    writeFileSync(requestPath, text, { flag: "wx" });
    command(binary, [requestPath, responsePath], environment());
    const status = statSync(responsePath);
    if (!status.isFile() || status.size > limits.maximumOutputBytes) {
      throw new Error("Native Rust source response exceeds the byte limit or is not a file.");
    }
    const response: unknown = JSON.parse(readFileSync(responsePath, "utf8"));
    if (!isRecord(response) || response.protocolVersion !== 1) {
      throw new Error("Native Rust source response has the wrong protocol identity.");
    }
    return response;
  };
  return Object.freeze({
    compilerIdentity,
    sysroot,
    tokens(source: string, edition: string): readonly RustLexicalTokenTree[] {
      return decodeNativeTokenResponse(request({ kind: "tokens", source, edition }), limits);
    },
    check(arguments_: readonly string[]): RustNativeEvidence {
      const response = request({ kind: "check", arguments: [compiler, "--sysroot", sysroot, ...arguments_] });
      if (!isRecord(response) || response.kind !== "evidence" || !isRecord(response.evidence)) {
        throw new Error("Native Rust source service did not return checked evidence.");
      }
      const evidence = decodeNativeEvidence(response.evidence, limits);
      validateRustNativeEvidenceInputs(evidence);
      return evidence;
    },
  });
}

function validateLimits(limits: RustNativeSourceLimits): void {
  for (const [name, value, ceiling] of [
    ["maximumRows", limits.maximumRows, 4_194_304],
    ["maximumDepth", limits.maximumDepth, 512],
    ["maximumOutputBytes", limits.maximumOutputBytes, 256 * 1024 * 1024],
    ["timeoutMilliseconds", limits.timeoutMilliseconds, 3_600_000],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) {
      throw new Error(`Native Rust source ${name} must be a positive integer no larger than ${ceiling}.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
