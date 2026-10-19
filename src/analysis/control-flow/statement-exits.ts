import type { AstReader, Node } from "@tsonic/tsts";
import { analyzeSourceStatementExits } from "@tsonic/target-api/analysis";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";
import type { RustStatementExitProducer } from "../program/records/statement-exits.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";

export function analyzeRustStatementExits(input: {
  readonly ast: AstReader;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly producer: RustStatementExitProducer;
  readonly required: RustRequiredRecord[];
}): void {
  const exits = analyzeSourceStatementExits(input.ast, input.nodes, {
    erased: node => input.records.nativeUnreachable.get(node) === true ||
      input.records.compileTimeSource.get(node) !== undefined || input.records.nativeParticipation.get(node) === "erased",
    expressionExits: node => isRustNeverCarrier(input.records.runtimeCarrier.get(node)?.carrier),
    guardResult: node => input.records.nativeGuardResult.get(node),
  });
  for (const [subject, alwaysExits] of exits) {
    requireRustRecord(input.required, "statementExit", subject, input.ast.kindName(subject), "analyzeRustStatementExits");
    input.producer.statement(subject, alwaysExits);
  }
}
