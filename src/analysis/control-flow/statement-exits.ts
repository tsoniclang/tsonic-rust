import type { Node, SourceFile } from "@tsonic/tsts";
import { analyzeSourceStatementExits, createSourceSwitchCoverage } from "@tsonic/target-api/analysis";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";
import type { RustStatementExitProducer } from "../program/records/operations/statement-exits.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export function analyzeRustStatementExits(input: {
  readonly source: TargetSourceProgram;
  readonly nodes: readonly Node[];
  readonly sourceFiles: readonly SourceFile[];
  readonly records: RustProgramRecords;
  readonly producer: RustStatementExitProducer;
  readonly required: RustRequiredRecord[];
}): void {
  const { ast } = input.source;
  const exits = analyzeSourceStatementExits(ast, input.nodes, {
    erased: node => input.records.nativeUnreachable.get(node) === true ||
      input.records.compileTimeSource.get(node) !== undefined || input.records.nativeParticipation.get(node) === "erased",
    expressionExits: node => input.records.expressionExit.get(node) !== undefined ||
      isRustNeverCarrier(input.records.runtimeCarrier.get(node)?.carrier),
    guardResult: node => input.records.nativeGuardResult.get(node),
    switchCoversDiscriminant: createSourceSwitchCoverage(input.source),
  });
  for (const [subject, alwaysExits] of exits) {
    requireRustRecord(input.required, "statementExit", subject, ast.kindName(subject), "analyzeRustStatementExits");
    input.producer.statement(subject, alwaysExits);
    if (ast.is.IsWhileStatement(subject) || ast.is.IsForStatement(subject)) {
      const condition = ast.is.IsForStatement(subject) ? ast.as.AsForStatement(subject)?.Condition
        : ast.as.AsWhileStatement(subject)?.Expression;
      const unconditional = condition === undefined || ast.kindName(condition) === "KindTrueKeyword";
      requireRustRecord(input.required, "loopForm", subject, ast.kindName(subject), "analyzeRustStatementExits");
      input.producer.loop(subject, { kind: unconditional ? "unconditional" : "conditional", neverFallsThrough: alwaysExits });
    }
  }
  for (const file of input.sourceFiles) input.producer.module(file,
    !ast.statements(file).some(statement => statement !== undefined && exits.get(statement) === true));
}
