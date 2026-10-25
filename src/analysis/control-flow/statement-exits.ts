import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { analyzeSourceStatementExits } from "@tsonic/target-api/analysis";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";
import type { RustStatementExitProducer } from "../program/records/statement-exits.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";

export function analyzeRustStatementExits(input: {
  readonly ast: AstReader;
  readonly nodes: readonly Node[];
  readonly sourceFiles: readonly SourceFile[];
  readonly records: RustProgramRecords;
  readonly producer: RustStatementExitProducer;
  readonly required: RustRequiredRecord[];
}): void {
  const exits = analyzeSourceStatementExits(input.ast, input.nodes, {
    erased: node => input.records.nativeUnreachable.get(node) === true ||
      input.records.compileTimeSource.get(node) !== undefined || input.records.nativeParticipation.get(node) === "erased",
    expressionExits: node => input.records.expressionExit.get(node) !== undefined ||
      isRustNeverCarrier(input.records.runtimeCarrier.get(node)?.carrier),
    guardResult: node => input.records.nativeGuardResult.get(node),
  });
  for (const [subject, alwaysExits] of exits) {
    requireRustRecord(input.required, "statementExit", subject, input.ast.kindName(subject), "analyzeRustStatementExits");
    input.producer.statement(subject, alwaysExits);
    if (input.ast.is.IsWhileStatement(subject) || input.ast.is.IsForStatement(subject)) {
      const condition = input.ast.is.IsForStatement(subject) ? input.ast.as.AsForStatement(subject)?.Condition
        : input.ast.as.AsWhileStatement(subject)?.Expression;
      const unconditional = condition === undefined || input.ast.kindName(condition) === "KindTrueKeyword";
      requireRustRecord(input.required, "loopForm", subject, input.ast.kindName(subject), "analyzeRustStatementExits");
      input.producer.loop(subject, { kind: unconditional ? "unconditional" : "conditional", neverFallsThrough: alwaysExits });
    }
  }
  for (const file of input.sourceFiles) input.producer.module(file,
    !input.ast.statements(file).some(statement => statement !== undefined && exits.get(statement) === true));
}
