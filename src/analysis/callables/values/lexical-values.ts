import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustLexicalValueProducer } from "../../program/records/storage/lexical-values.js";
import type { RustLexicalValueDeclaration } from "../../../target-model/records/storage/lexical-values.js";
import { rustSourceCallableValueEquals } from "../../../target-model/records/operations/equality.js";

export function analyzeRustLexicalValues(input: {
  readonly program: Pick<RustAnalysisProgram, "sourceNavigation" | "lexicalFunctions" | "names" | "records">;
  readonly nodes: readonly Node[];
  readonly producer: RustLexicalValueProducer;
}): void {
  for (const statement of input.nodes) {
    const values: RustLexicalValueDeclaration[] = [];
    for (const declaration of input.program.lexicalFunctions.valueDeclarationsAt(statement)) {
      const selected = input.program.lexicalFunctions.forDeclaration(declaration);
      if (selected?.kind !== "resolved" || !selected.valueObserved) continue;
      const name = input.program.names.callableValueNameForDeclaration(declaration);
      const candidates = input.program.sourceNavigation.declarationUseSummary(declaration).uses.flatMap(use => {
        const value = input.program.records.sourceCallableValue.get(use.reference);
        return value === undefined ? [] : [value];
      });
      const value = candidates[0];
      if (name === undefined || value === undefined || value.sourceDeclaration !== declaration ||
        !candidates.every(candidate => rustSourceCallableValueEquals(candidate, value)))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted lexical function requires its exact checked callable-value contract.", declaration);
      values.push(Object.freeze({ declaration, name, value }));
    }
    if (values.length !== 0) input.producer.statement(statement, values);
  }
}
