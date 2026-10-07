import type { Node } from "@tsonic/tsts";
import { sourceMayReadBeforeInitialization } from "@tsonic/target-api/source";
import { rustCallableInputMatches } from "../../target-model/conversions/callable-input.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { rustContextualValueConversionFactKey, rustDirectCallableReferenceFactKey } from "../facts/keys.js";
import type { RustSourceCallableValueFact } from "../facts/keys.js";
import type { RustFactWalk } from "../program/walk.js";

export function selectRustInlineModuleCallableAliases(
  walk: RustFactWalk, expression: Node, producer: RustSourceCallableValueFact,
): { readonly declarations: readonly Node[]; readonly references: readonly Node[] } | undefined {
  const { ast, source, facts } = walk.context;
  const flow = source.navigation.expressionValueFlow(expression);
  if (flow.aliasDeclarations.length === 0 || flow.aliasDeclarations.length > 1_024 ||
    flow.uses.length > 131_072 || flow.memberWritten || flow.receiverUsed || flow.identityCompared ||
    flow.captured || flow.returned || flow.yielded || flow.storedOutsideBinding || flow.exported || flow.hasUnclassifiedUse) return undefined;
  const aliases = new Set(flow.aliasDeclarations);
  for (const declaration of aliases) {
    if (!ast.is.IsVariableDeclaration(declaration)) return undefined;
    const summary = source.navigation.declarationUseSummary(declaration);
    const initializer = ast.as.AsVariableDeclaration(declaration)?.Initializer;
    const previous = initializer === undefined ? undefined : source.navigation.sourceReferenceFor(initializer)?.declaration;
    const carrier = facts.get(declaration, rustRuntimeCarrierKey)?.carrier;
    if (ast.variableDeclarationKind(declaration) !== "const" ||
      !ast.is.IsIdentifier(ast.name(declaration)) || summary.bindingWritten ||
      sourceMayReadBeforeInitialization(declaration, ast, source.navigation) ||
      initializer !== expression && (previous === undefined || !aliases.has(previous)) ||
      carrier === undefined || !rustTargetTypeRefEquals(carrier, producer.carrier)) return undefined;
  }
  const references: Node[] = [];
  for (const use of flow.uses) {
    if (use.kind === "type-only" || use.role === "storage") continue;
    const selected = facts.get(use.reference, rustContextualValueConversionFactKey);
    const reference = facts.get(use.reference, rustDirectCallableReferenceFactKey);
    const carrier = facts.get(use.reference, rustRuntimeCarrierKey)?.carrier;
    if (use.role !== "argument" || carrier === undefined || !rustTargetTypeRefEquals(carrier, producer.carrier) ||
      reference !== undefined && (reference.sourceDeclaration !== producer.sourceDeclaration ||
        !rustTargetTypeRefEquals(reference.carrier, producer.carrier)) ||
      selected?.conversion.kind !== "callable-input" || !rustCallableInputMatches(carrier, selected.targetCarrier)) return undefined;
    references.push(use.reference);
  }
  return Object.freeze({ declarations: Object.freeze([...aliases]), references: Object.freeze(references) });
}
