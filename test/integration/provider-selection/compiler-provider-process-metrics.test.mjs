import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider process metrics preserve closed source domains and native CPU results", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_process_metrics" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import { cpuUsage, execArgv } from "node:process";
function platform(): string {
  switch (process.platform) {
    case "win32": case "cygwin": return "windows";
    case "sunos": return "solaris";
    case "aix": case "android": case "darwin": case "freebsd": case "haiku":
    case "linux": case "netbsd": case "openbsd": return process.platform;
  }
}
function arch(): string {
  switch (process.arch) {
    case "x64": return "amd64";
    case "ia32": return "386";
    case "arm": case "arm64": case "loong64": case "mips": case "mipsel":
    case "ppc64": case "riscv64": case "s390x": return process.arch;
  }
}
export function main(): void {
  check(platform().length > 0 && arch().length > 0);
  check(process.execArgv.length === 0 && execArgv.length === 0);
  const before = cpuUsage();
  const after = process.cpuUsage();
  check(after.user >= before.user && after.system >= before.system);
  const delta = cpuUsage(before);
  check(delta.user >= 0 && delta.system >= 0);
  const zero = { system: 0, user: 0 };
  const alias = zero;
  const total = cpuUsage(alias);
  check(total.user >= after.user && total.system >= after.system);
  zero.user = 9007199254740991;
  zero.system = 9007199254740991;
  const fromChangedSource = cpuUsage(alias);
  check(fromChangedSource.user < 0 && fromChangedSource.system < 0);
  check(total.user >= 0 && total.system >= 0);
  before.user = 9007199254740991;
  before.system = 9007199254740991;
  const negative = process.cpuUsage(before);
  check(negative.user < 0 && negative.system < 0);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-process-metrics", result.artifacts, { run: true });
});
