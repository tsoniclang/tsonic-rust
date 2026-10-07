import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustRuntimeCarrierKey } from "../../../dist/target-model/facts/selections.js";
import { rustJsErrorTargetType } from "../../../dist/target-model/types/index.js";
import { rustSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";

for (const surfaces of [[], ["js"]]) {
  test(`type-only Error aliases preserve their actual native domain on ${surfaces[0] ?? "native"}`, () => {
    for (const projectError of [false, true]) {
      const { program } = analyzeRust({ surfaces, files: {
        "types.ts": `export type Failure = Error;
          export type OptionalFailure = Error | null | undefined;
          export interface Errors { failure: Failure; }
          ${projectError ? 'export class CustomFailure extends Error {}' : ""}`,
        "index.ts": `import type { Failure } from "./types.js";
          export function observe(failure: Failure): string { return failure.message; }`,
      } });
      const file = program.sourceFiles.find(source => program.source.ast.getFileName(source).endsWith("types.ts"));
      const declaration = program.source.ast.statements(file).find(node =>
        program.source.ast.is.IsTypeAliasDeclaration(node) &&
        program.source.ast.text(program.source.ast.name(node)) === "Failure");
      const fact = program.facts.getFact(declaration, rustRuntimeCarrierKey);
      assert.equal(fact !== undefined, true, "the type alias has an exact finalized carrier");
      assert.deepEqual(fact.carrier, projectError ? rustSourceErrorTargetType() : rustJsErrorTargetType());
      assert.equal(program.projectTypes.sourceErrorDefinitions.length, projectError ? 1 : 0);
    }
  });
}
