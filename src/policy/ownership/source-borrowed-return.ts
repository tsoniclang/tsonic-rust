import type { Node } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext } from "../types/resolution/model.js";
import { rustDirectLexicalCallableBinding, rustSourceDirectCalls } from "./source-lexical-callable.js";

export function rustSourceBorrowedReturnParameter(
  declaration: Node,
  context: RustTargetTypeResolutionContext,
): Node | undefined {
  const { ast, sourceStorage, source } = context;
  const binding = ast.is.IsFunctionDeclaration(declaration) ? declaration
    : rustDirectLexicalCallableBinding(declaration, source);
  if (binding === undefined) return undefined;
  if (ast.body(declaration) === undefined || ast.hasModifierKind(declaration, "async") ||
    context.semanticsFor(declaration).operations.generator(declaration) !== undefined ||
    context.semanticsFor(declaration).operations.callableCompletion(declaration)?.canFallThrough !== false) return undefined;
  const result = sourceStorage.subject(declaration, "return");
  const bindings = sourceStorage.bindingsForDeclaration(declaration);
  if (result.kind !== "resolved" || bindings.kind !== "resolved") return undefined;
  const origins = sourceStorage.boundOriginsFor(result.subject, bindings.bindings);
  if (origins.kind !== "resolved" || origins.subjects.length !== 1) return undefined;
  const origin = origins.subjects[0]!;
  if (origin.kind !== "input" || origin.projection.length !== 0 ||
    !ast.parameters(declaration).includes(origin.node)) return undefined;
  const parameter = origin.node;
  const summary = source.navigation.parameterUseSummary(parameter);
  if (summary === undefined || summary.bindingWritten || summary.memberWritten || summary.captured ||
    summary.yielded || summary.passedAsArgument || summary.aliasedOrStored || summary.exported ||
    summary.hasUnclassifiedValueUse || !summary.returned || summary.uses.some(use => use.throughMember ||
      !["return", "comparison", "condition", "type-only"].includes(use.role))) return undefined;
  const calls = rustSourceDirectCalls(binding, declaration, source);
  if (calls === undefined) return undefined;
  for (const call of calls) {
    const selected = source.semantics.forNode(call).operations.call(call);
    const inputs = selected?.sourceArgumentBindings.filter(input =>
      input.sourceParameterIndex === ast.parameters(declaration).indexOf(parameter));
    if (inputs?.length !== 1 || inputs[0]!.sourceForm !== "value" || inputs[0]!.sourceParameterForm !== "parameter") return undefined;
    const resultFlow = source.navigation.expressionValueFlow(call);
    if (resultFlow.escapes || resultFlow.bindingAliased || resultFlow.aliasDeclarations.length !== 0 ||
      resultFlow.hasUnclassifiedUse || resultFlow.uses.some(resultUse => resultUse.throughMember ||
        resultUse.role !== "comparison" && resultUse.role !== "condition")) return undefined;
  }
  return parameter;
}
