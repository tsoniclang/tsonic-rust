import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("optional native records enter closed values without copying their live backing", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "closed_record_admission" } },
    files: { "index.ts": `
import type { uint64 } from "@tsonic/core/types.js";
class Request { body: unknown = null; }
interface Parsed { body?: Record<string, unknown> }
function assign(request: Request, parsed: Parsed): void { request.body = parsed.body; }
export function main(): void {
  const body: Record<string, unknown> = { wide: 18446744073709551615n as uint64 };
  const request = new Request();
  assign(request, { body });
  if (JSON.stringify(request.body) !== '{"wide":18446744073709551615}') throw new Error("wide record");
  body["wide"] = null;
  if (JSON.stringify(request.body) !== '{"wide":null}') throw new Error("live record");
  assign(request, {});
  if (request.body !== null || JSON.stringify(request.body) !== "null") throw new Error("absent record");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /JsValue::from/u);
  assert.doesNotMatch(output, /from_closed|JsObject::from_pairs|copy_entries_to|from_optional_pairs/u);
  validateGeneratedProject("closed-record-admission", result.artifacts, { run: true });
});
