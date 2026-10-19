import type { AstReader } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { sourceLexicalFunctionIsUnused, sourceNodesOutsideErasedSubtrees,
  sourceCallableDefinitionIsDiscarded,
  type SourceProgramNavigation, type SourceSubtreeParticipation } from "@tsonic/target-api/source";
import type { RustNativeParticipation } from "../../target-model/records/native-demand.js";
import type { RustNativeParticipationProducer } from "../program/records/native-participation.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";

export function analyzeRustNativeParticipation(input: {
  readonly ast: AstReader;
  readonly storage: Pick<SourceStorageQueries, "nodes" | "failureReason">;
  readonly navigation: Pick<SourceProgramNavigation, "declarationUseSummary" | "declarationSymbol" |
    "sourceReferenceFor" | "callableImplementation" | "referencesWithin" | "sourceFiles" | "expressionValueFlow">;
  readonly producer: RustNativeParticipationProducer;
  readonly requiredRecords: RustRequiredRecord[];
}): SourceSubtreeParticipation {
  const failure = input.storage.failureReason();
  if (failure !== undefined) return Object.freeze({ kind: "unresolved", reason: failure });
  return sourceNodesOutsideErasedSubtrees(input.ast, input.storage.nodes, node => {
    const anonymous = input.ast.is.IsArrowFunction(node) || input.ast.is.IsFunctionExpression(node);
    let participation: RustNativeParticipation;
    if (anonymous) {
      participation = sourceCallableDefinitionIsDiscarded(node, input.ast, input.navigation) ? "erased" : "body";
    } else {
      if (!input.ast.is.IsFunctionDeclaration(node)) return false;
      const parent = input.ast.parent(node);
      const moduleLevel = parent !== undefined && input.ast.is.IsSourceFile(parent);
      if (input.ast.body(node) === undefined) {
        const implementation = moduleLevel ? input.navigation.callableImplementation(node) : undefined;
        participation = !moduleLevel || implementation?.kind === "resolved" && implementation.implementation.declaration !== node
          ? "erased" : "body";
      } else {
        participation = moduleLevel || !sourceLexicalFunctionIsUnused(node, input.ast, input.navigation) ? "body" : "erased";
      }
    }
    requireRustRecord(input.requiredRecords, "nativeParticipation", node,
      anonymous ? "anonymous-callable-creation" : "named-function-placement", "nativeParticipations.selected");
    input.producer.selected(node, participation);
    return participation === "erased";
  });
}
