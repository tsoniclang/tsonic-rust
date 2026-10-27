import type { AstReader, Node } from "@tsonic/tsts";
import { analyzeSourceResourceScopes } from "@tsonic/target-api/analysis";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";
import type { RustResourceScopeProducer } from "../program/records/storage/resource-scopes.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export function analyzeRustResourceScopes(input: {
  readonly ast: AstReader; readonly nodes: readonly Node[]; readonly records: RustProgramRecords;
  readonly producer: RustResourceScopeProducer; readonly required: RustRequiredRecord[];
}): void {
  const selected = analyzeSourceResourceScopes(input.ast, input.nodes, node =>
    input.records.nativeUnreachable.get(node) === true || input.records.compileTimeSource.get(node) !== undefined ||
    input.records.nativeParticipation.get(node) === "erased");
  for (const [subject, scope] of selected.scopes) {
    requireRustRecord(input.required, "resourceScope", subject, input.ast.kindName(subject), "analyzeRustResourceScopes");
    input.producer.scope(subject, scope);
  }
  for (const [subject, declarations] of selected.variables) {
    requireRustRecord(input.required, "variableDeclarations", subject, input.ast.kindName(subject), "analyzeRustResourceScopes");
    input.producer.variables(subject, declarations);
  }
  for (const [subject, tail] of selected.tails) {
    const exits = tail.some(node => input.records.statementExit.get(node) === true ||
      isRustNeverCarrier(input.records.runtimeCarrier.get(node)?.carrier));
    requireRustRecord(input.required, "resourceContinuationExit", subject, input.ast.kindName(subject), "analyzeRustResourceScopes");
    input.producer.continuation(subject, exits);
  }
}
