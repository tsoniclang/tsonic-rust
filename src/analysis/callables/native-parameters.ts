import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeStoragePlan, RustNativeStorageQueries, RustNativeStorageSelection } from "./native-storage.js";

export function finalizeRustNativeParameterStorage(input: {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
}, queries: RustNativeStorageQueries): RustNativeStoragePlan {
  const parameters = new Map<Node, RustNativeStorageSelection>();
  const unavailable: RustNativeStorageSelection = Object.freeze({ kind: "unresolved",
    reason: "Native parameter storage requires its exact owned formal parameter." });
  for (const node of input.storage.nodes) {
    const abi = input.records.sourceParameterAbi.get(node);
    if (abi === undefined || !input.ast.is.IsParameterDeclaration(node)) continue;
    const owner = input.ast.parent(node);
    if (owner === undefined || !input.ast.parameters(owner).includes(node)) continue;
    const subject = input.storage.subject(node, "input");
    parameters.set(node, subject.kind === "unresolved" ? subject
      : queries.subjectFor(subject.subject, abi.parameterCarrier, owner));
  }
  return Object.freeze({ ...queries,
    parameterFor: (parameter: Node): RustNativeStorageSelection => parameters.get(parameter) ?? unavailable });
}
