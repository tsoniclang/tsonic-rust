import assert from "node:assert/strict";
import test from "node:test";
import { createRustCompilerProviderSession } from "../../../../dist/providers/compiler/session.js";

test("closing a compiler-provider session revokes its per-build snapshot lease", () => {
  const snapshot = Object.freeze({
    kind: "standard-library",
    digest: "fixture-standard-library",
    dependencies: Object.freeze([]),
  });
  const worker = Object.freeze({
    standardSnapshot() {
      return snapshot;
    },
  });
  const session = createRustCompilerProviderSession({
    configuration: {
      crateName: "fixture",
      edition: "2021",
      outputType: "lib",
      project: { kind: "generated" },
    },
  }, worker);
  const [provider] = session.sourceProviders;

  assert.ok(provider);
  session.close();
  session.close();
  assert.throws(
    () => provider.ownsModule("@tsonic/rust/std/vec.js"),
    /snapshot lease is closed/u,
  );
  assert.throws(
    () => session.semantics(),
    /session is closed/u,
  );
});
