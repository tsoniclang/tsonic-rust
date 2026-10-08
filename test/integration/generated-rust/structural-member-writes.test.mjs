import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { structuralMemberWritesSource } from "../../../../tsonic/test/fixtures/structural-member-writes.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) test(`structural member writes preserve native aliases and callback identity in ${surfaces[0] ?? "native"}`,
  { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": structuralMemberWritesSource } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`structural-member-writes-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
