import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("owned async values enter their selected native union arm without an additional adapter future", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "source_union_payload_admission" } },
    files: { "index.ts": `
import type { uint64 } from "@tsonic/core/types.js";
class Response { readonly accepted = true; }
type Completion = Response | Promise<uint64>;
async function finish(): Promise<uint64> { return 18446744073709551615n as uint64; }
function choose(wait: boolean): Completion {
  if (wait) return finish();
  return new Response();
}
export async function main(): Promise<void> {
  const immediate = choose(false);
  if (!(immediate instanceof Response) || !immediate.accepted) throw new Error("response arm");
  const pending = choose(true);
  if (pending instanceof Response) throw new Error("future arm");
  const completed = await pending;
  if (completed !== (18446744073709551615n as uint64)) throw new Error("exact future payload");
}
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /Box::|boxed\(|\.map\(|\.then\(|from_closed|Any|downcast/u);
  validateGeneratedProject("source-union-payload-admission", result.artifacts, { run: true });
});
