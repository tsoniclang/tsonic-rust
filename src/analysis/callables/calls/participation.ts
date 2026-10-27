import type { AstReader } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { sourceLexicalFunctionIsUnused, sourceNodesOutsideErasedSubtrees,
  sourceCallableDefinitionIsDiscarded,
  type SourceProgramNavigation, type SourceSubtreeParticipation } from "@tsonic/target-api/source";
import type { RustNativeParticipation } from "../../../target-model/records/native/native-demand.js";
import type { RustNativeParticipationProducer } from "../../program/records/native/native-participation.js";
import { requireRustRecord, type RustRequiredRecord } from "../../program/records/objects/required-records.js";

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
    // An object literal method or accessor is a callable value created where the literal is evaluated, like a function
    // expression.
    const literalMethod = (input.ast.is.IsMethodDeclaration(node) || input.ast.is.IsGetAccessorDeclaration(node) ||
      input.ast.is.IsSetAccessorDeclaration(node)) && input.ast.parent(node) !== undefined &&
      input.ast.is.IsObjectLiteralExpression(input.ast.parent(node)!);
    const anonymous = input.ast.is.IsArrowFunction(node) || input.ast.is.IsFunctionExpression(node) || literalMethod;
    let participation: RustNativeParticipation;
    if (anonymous) {
      // A module-level const callable is an authored module declaration, kept like a module function declaration
      // (unused ones carry a dead-code expectation); other unobserved callable values are erased.
      const declaration = input.ast.parent(node);
      const list = declaration === undefined ? undefined : input.ast.parent(declaration);
      const statement = list === undefined ? undefined : input.ast.parent(list);
      const owner = statement === undefined ? undefined : input.ast.parent(statement);
      const moduleDeclaration = declaration !== undefined && input.ast.is.IsVariableDeclaration(declaration) &&
        statement !== undefined && input.ast.is.IsVariableStatement(statement) && owner !== undefined && input.ast.is.IsSourceFile(owner);
      participation = !moduleDeclaration && sourceCallableDefinitionIsDiscarded(node, input.ast, input.navigation) ? "erased" : "body";
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
