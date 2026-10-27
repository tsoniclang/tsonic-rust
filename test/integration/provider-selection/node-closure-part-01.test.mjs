import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeCalls, nativeNodes, nativeType, nativeBorrow, nativeDispatchBinding } from "../../helpers/native-ast.mjs";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
  nodejsCapability,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("buffer, url, crypto, process, and util lower through provider rows", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { Buffer } from "node:buffer";
import { URL, URLSearchParams } from "node:url";
import { createHash } from "node:crypto";
import { pid, env } from "node:process";
import type { int32 } from "@tsonic/core/types.js";

export function probe(): string {
  const buf = Buffer.from("hi", "utf8");
  const size: int32 = buf.length as int32;
  const u = new URL("https://example.com/a?b=1");
  const params = new URLSearchParams("x=1");
  const h = createHash("sha256");
  h.update("abc");
  const id: int32 = pid as int32;
  if (size > 0 && id > 0) {
    return u.pathname + (params.get("x") ?? "") + h.digest("hex") + (env["PATH"] ?? "");
  }
  return "";
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::buffer::Buffer::from_string_enc\("hi", "utf8"\)\?/u);
  assert.match(text, /rt::conversions::usize_to_i32\(buf\.len\(\)\)\?/u);
  assert.match(text, /tsonic_rust_node::url::Url::parse\(\s*"https:\/\/example\.com\/a\?b=1",\s*None,?\s*\)\?/u);
  assert.match(text, /tsonic_rust_node::url::UrlSearchParams::new_from\("x=1"\)\?/u);
  assert.match(text, /h\.update_str_owned\("abc"\)\?/u);
  assert.match(text, /h\.digest_string\("hex"\)\?/u);
  assert.match(text, /rt::conversions::u32_to_i32\(tsonic_rust_node::process::pid\(\)\)\?/u);
  assert.match(text, /tsonic_rust_node::process::environment\(\)\s*\.get\("PATH"\)\s*\.unwrap_or_default\(\)/u);
});

test("portable Node boundaries lower through exact selected provider evidence", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { TextDecoder } from "node:util";
import { format, parse } from "node:url";

export function status(command: string, args: string[]): number | null {
  const result = spawnSync(command, args);
  result.status = null;
  return result.status;
}

export function symbolic(path: string): boolean {
  return lstatSync(path).isSymbolicLink();
}

export function legacyRoundTrip(value: string): string {
  const parsed = parse(value);
  parsed.href = value;
  parsed.pathname = "/checked";
  parsed.query = null;
  return format(parsed) + (parsed.pathname ?? "");
}

export function decode(value: string): string {
  return new TextDecoder().decode(Buffer.from(value, "utf8"));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::child_process::spawn_sync_result/u);
  assert.match(text, /tsonic_rust_node::fs::lstat_sync/u);
  assert.match(text, /tsonic_rust_node::url::parse_legacy/u);
  assert.match(text, /tsonic_rust_node::url::format_legacy/u);
  assert.match(text, /set_required_href/u);
  assert.match(text, /tsonic_rust_node::util::text_decoder_new\(\)/u);
  assert.match(text, /\.decode_buffer\(/u);
});

test("spawnSync accepts the selected native array carrier without the JS surface", async () => {
  const { result } = compileRust({
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { spawnSync } from "node:child_process";

export function status(command: string, args: string[]): number | null {
  return spawnSync(command, args).status;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /tsonic_rust_node::child_process::spawn_sync_result/u,
  );
});

test("legacy URL declarations reject non-null source assumptions", async () => {
  const capability = await nodejsCapability();

  assert.throws(
    () => compileRust({
      capabilities: [capability],
      files: {
        "index.ts": `
import { parse } from "node:url";

export function invalid(value: string): string {
  return parse(value).pathname;
}
`,
      },
    }),
    /TS2322[\s\S]*string \| null/u,
  );
});

test("generated cargo binary proves the multi-module node closure at runtime", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r7_node_proof" } },
    files: {
      "index.ts": `
import { Buffer } from "node:buffer";
import { URL, URLSearchParams, pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { cwd, pid, env, platform, arch, argv } from "node:process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, copyFileSync, renameSync, unlinkSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { hostname, tmpdir, homedir } from "node:os";
import { stripVTControlCharacters, toUSVString, getSystemErrorName } from "node:util";
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  const dir = join(cwd(), "r7_proof_dir");
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
  mkdirSync(dir);
  const file = join(dir, "data.txt");
  writeFileSync(file, "r7 payload", "utf8");
  check(readFileSync(file, "utf8") === "r7 payload");
  check(readdirSync(dir).length === 1);
  const st = statSync(file);
  check(st.isFile());
  check(!st.isDirectory());
  check(st.size === 10);
  const copy = join(dir, "copy.txt");
  copyFileSync(file, copy);
  const renamed = join(dir, "renamed.txt");
  renameSync(copy, renamed);
  check(existsSync(renamed));
  check(realpathSync(dir).length > 0);
  unlinkSync(renamed);
  rmSync(dir, { recursive: true });
  check(!existsSync(dir));

  const path_var = env["PATH"] ?? "";
  check(path_var.length > 0);
  check(env["R7_UNSET_VAR_PROOF"] === undefined);
  check(platform.length > 0);
  check(arch.length > 0);
  check(pid > 0);
  check(argv.length > 0);
  check(hostname().length > 0);
  check(tmpdir().length > 0);
  const home = homedir() ?? "";
  check(home.length >= 0);

  const buf = Buffer.from("abc", "utf8");
  check(buf.length === 3);
  check(buf.readUInt8(0) === 97);
  const other = Buffer.from("abc", "utf8");
  check(buf.equals(other));
  check(buf.compare(other) === 0);
  check(Buffer.byteLength("abc", "utf8") === 3);
  const filled = Buffer.alloc(2);
  filled.writeUInt8(65, 0);
  filled.writeUInt8(66, 1);
  check(filled.toString("utf8") === "AB");
  const merged = Buffer.concat([buf, filled]);
  check(merged.length === 5);

  const u = new URL("https://user.example.com:8443/docs/page?q=rust#top");
  check(u.protocol === "https:");
  check(u.hostname === "user.example.com");
  check(u.port === "8443");
  check(u.pathname === "/docs/page");
  check(u.search === "?q=rust");
  check(u.hash === "#top");
  check(u.origin === "https://user.example.com:8443");
  const params = new URLSearchParams("a=1&b=2");
  check((params.get("a") ?? "") === "1");
  check(params.has("b"));
  params.set("a", "9");
  params.append("c", "3");
  check(params.toString().length > 0);
  const roundtrip = fileURLToPath(pathToFileURL("/tmp/r7"));
  check(roundtrip === "/tmp/r7");

  check(randomUUID().length === 36);
  const h = createHash("sha256");
  h.update("abc");
  const digest = h.digest("hex");
  check(digest.length === 64);
  check(digest.startsWith("ba7816bf"));
  check(digest.endsWith("f20015ad"));

  check(stripVTControlCharacters("plain") === "plain");
  check(toUSVString("ok") === "ok");
  const errName = getSystemErrorName(-2);
  check(errName.length > 0);
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("r7-node-closure-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
