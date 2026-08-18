import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  assertRustTargetRejection,
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
  const size: int32 = buf.length;
  const u = new URL("https://example.com/a?b=1");
  const params = new URLSearchParams("x=1");
  const h = createHash("sha256");
  h.update("abc");
  const id: int32 = pid;
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
  assert.match(text, /tsonic_rust_node::buffer::Buffer::from_string_enc\("hi", "utf8"\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  assert.match(text, /tsonic_rust_runtime::conversions::usize_to_i32\(buf\.len\(\)\)\?/u);
  assert.match(text, /tsonic_rust_node::url::Url::parse\(\s*"https:\/\/example\.com\/a\?b=1",\s*None,?\s*\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  assert.match(text, /tsonic_rust_node::url::UrlSearchParams::new_from\("x=1"\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  assert.match(text, /h\.update_str_owned\("abc"\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  assert.match(text, /h\.digest_string\("hex"\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  assert.match(text, /tsonic_rust_runtime::conversions::u32_to_i32\(tsonic_rust_node::process::pid\(\)\)\?/u);
  assert.match(text, /rt::option_coalesce\(\s*tsonic_rust_node::process::env_get\("PATH"\),\s*std::convert::identity,/u);
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
    rmSync(dir, true);
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
  rmSync(dir, true);
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
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("r7-node-closure-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("generated cargo library proves async fs/promises rows", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { readFile, writeFile, readdir, stat, mkdir, rm, copyFile, rename, unlink } from "node:fs/promises";
import type { int32 } from "@tsonic/core/types.js";

export async function roundtrip(dir: string, file: string): Promise<int32> {
  await mkdir(dir);
  await writeFile(file, "async payload", "utf8");
  const text = await readFile(file, "utf8");
  const names = await readdir(dir);
  const info = await stat(file);
  const written = info.size;
  const copied = file + ".copy";
  await copyFile(file, copied);
  const renamed = file + ".renamed";
  await rename(copied, renamed);
  await unlink(renamed);
  await rm(dir);
  let total: int32 = names.length;
  if (text.length > 0 && written > 0) {
    total += 1;
  }
  return total;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub async fn roundtrip\(dir: String, file: String\) -> rt::TsonicResult<i32> \{/u);
  assert.match(text, /tsonic_rust_node::fs_promises::mkdir_async\(&dir, true\)\s*\.await\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  assert.match(text, /tsonic_rust_node::fs_promises::read_file_string_async\(&file, "utf8"\)\s*\.await\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  validateGeneratedProject("r7-async-fs-lib", result.artifacts);
});

test("process env writes fail closed", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { env } from "node:process";

export function bad(): void {
  env["X"] = "1";
}
`,
    },
  });
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code, message, evidence }) => ({ code, message, evidence })), [{
    code: "RUST_SELECTED_ASSIGNMENT_UNSUPPORTED",
    message: "Checked assignment target has no finalized Rust write operation.",
    evidence: [
      "target.capability=rust.operation.assignment",
      "source.operatorKind=KindEqualsToken",
    ],
  }]);
});

test("absent env reads preserve undefined", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { env } from "node:process";

export function read(name: string): string {
  const value = env[name];
  if (value === undefined) {
    return "";
  }
  return value ?? "";
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::process::env_get\(&name\)/u);
  assert.match(text, /value\.is_none\(\)/u);
});

test("unsupported node APIs fail closed with deterministic diagnostics", async () => {
  const cases = [
    { module: "node:fs", name: "watch", call: "watch(\"x\")" },

    { module: "node:fs", name: "createWriteStream", call: "createWriteStream(\"x\")" },

  ];
  for (const item of cases) {
    const options = {
      surfaces: ["js"],
      capabilities: [await nodejsCapability()],
      files: {
        "index.ts": `
import { ${item.name} } from "${item.module}";

export function bad(): void {
  ${item.call};
}
`,
      },
    };
    assertRustTargetRejection(options, [{
      code: "RUST_PROVIDER_OPERATION_NOT_MAPPED",
      message: `No Rust operation row matches selected provider declaration 'tsonic.rust.provider-package.@tsonic/rust-nodejs.binding::tsonic.rust.node.fs::${item.module}::${item.name}::${item.module}::${item.name}(...)' as method.`,
    }]);
  }
});
