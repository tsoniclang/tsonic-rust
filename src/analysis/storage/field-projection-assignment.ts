import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustFieldProjectionAssignmentProducer } from "../program/records/storage/field-projection-assignment.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export function analyzeRustFieldProjectionAssignments(input: {
  readonly ast: AstReader; readonly nodes: readonly Node[]; readonly records: RustProgramRecords;
  readonly navigation: SourceProgramNavigation; readonly projectTypes: RustProjectTypePolicy;
  readonly representations: RustObjectRepresentationPlan; readonly dispatch: RustProjectFieldDispatchQueries;
  readonly producer: RustFieldProjectionAssignmentProducer; readonly required: RustRequiredRecord[];
}): void {
  const pure = (node: Node): boolean => {
    const effects = input.navigation.expressionEffects(node);
    return !effects.invokes && !effects.mutates && !effects.suspends;
  };
  const directPlace = (node: Node): boolean => {
    if (input.ast.kindName(node) === "KindThisExpression" || input.ast.kindName(node) === "KindThisKeyword") return true;
    if (input.ast.is.IsIdentifier(node)) {
      const declaration = input.records.sourceBinding.get(node)?.sourceDeclaration;
      return declaration !== undefined && input.records.bindingStorage.get(declaration) === undefined &&
        input.records.moduleBinding.get(declaration)?.storage !== "module-cell";
    }
    if (input.ast.is.IsParenthesizedExpression(node)) {
      const inner = Node_Expression(input.ast, node);
      return inner !== undefined && directPlace(inner);
    }
    const field = input.records.targetOperation.get(node);
    const receiver = Node_Expression(input.ast, node);
    return field?.kind === "source-field" && field.storage === "project-object" && field.valueSemantics.kind === "stored" &&
      field.dispatch === undefined && receiver !== undefined && directPlace(receiver) &&
      input.representations.representationFor(input.projectTypes.definitionForCarrier(field.receiverCarrier))?.kind === "value";
  };
  for (const node of input.nodes) {
    if (!input.ast.is.IsBinaryExpression(node) || input.records.nativeUnreachable.get(node) === true ||
      input.records.assignmentCompletion.get(node) === undefined && input.records.targetOperation.get(node)?.kind !== "nullish-assignment") continue;
    const left = BinaryExpression_Left(input.ast, node);
    const right = BinaryExpression_Right(input.ast, node);
    if (left === undefined || right === undefined || !pure(right)) continue;
    let current: Node | undefined = left;
    while (current !== undefined) {
      const field = input.records.targetOperation.get(current);
      if (field?.kind === "source-field" || field?.kind === "source-union-field") {
        if (current === left || field.kind !== "source-field" || field.valueSemantics.kind !== "stored" || field.resultCarrier.kind !== "array") break;
        const receiver = Node_Expression(input.ast, current);
        if (receiver === undefined) break;
        if (field.storage === "project-object" && field.dispatch === undefined &&
          input.representations.representationFor(input.projectTypes.definitionForCarrier(field.receiverCarrier))?.kind === "value" && directPlace(receiver)) break;
        if (field.dispatch !== undefined) {
          const selected = field.declaration === undefined ? undefined : input.dispatch.planFor(field.declaration);
          if (selected?.stored !== true || !selected.mutableContent) break;
        }
        requireRustRecord(input.required, "fieldProjectionAssignment", node, "array-field projection", "analyzeRustFieldProjectionAssignments");
        input.producer.assignment(node, { expression: current, receiver, field });
        break;
      }
      const argument = input.ast.as.AsElementAccessExpression(current)?.ArgumentExpression;
      if (argument !== undefined && !pure(argument)) break;
      if (!input.ast.is.IsPropertyAccessExpression(current) && !input.ast.is.IsElementAccessExpression(current) &&
        !input.ast.is.IsParenthesizedExpression(current)) break;
      current = Node_Expression(input.ast, current);
    }
  }
}
