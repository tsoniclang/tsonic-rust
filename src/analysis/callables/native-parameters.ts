import type { AstReader, Node } from "@tsonic/tsts";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeStorageConstruction, RustNativeStorageQueries } from "./native-storage.js";
import type { RustNativeStorageSelection } from "../../target-model/records/native-storage.js";

export function finalizeRustNativeParameterStorage(input: {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly records: RustProgramRecords;
}, queries: RustNativeStorageQueries): RustNativeStorageConstruction {
  const parameters = new Map<Node, RustNativeStorageSelection>();
  for (const node of input.nativeNodes) {
    const abi = input.records.sourceParameterAbi.get(node);
    if (abi === undefined || !input.ast.is.IsParameterDeclaration(node)) continue;
    const owner = input.ast.parent(node);
    if (owner === undefined || sourceCallableValueParameters(input.ast, owner, input.storage.source.semantics.forNode(owner))?.includes(node) !== true) continue;
    const subject = input.storage.subject(node, "input");
    parameters.set(node, subject.kind === "unresolved" ? subject
      : queries.subjectFor(subject.subject, abi.parameterCarrier, owner));
  }
  return Object.freeze({ ...queries,
    parameterFor: sealRustNativeParameterStorage(parameters).get });
}

import { sealRustNativeParameterStorage } from "../program/records/native-parameters.js";
