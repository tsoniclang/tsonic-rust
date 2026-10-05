import { Node_Initializer, sourceParameterIsProperty, selectSourceNativeGuardResult } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustObjectRepresentationAnalysisInput } from "./object-representation.js";
import type { RustReceiverFieldAliasQueries } from "./receiver-field-aliases.js";
import type { RustProjectTypeDefinition } from "./type-policy.js";
import { rustProjectObjectLayout } from "./object-layout.js";
import { analyzeRustConstructionReadiness, type RustConstructionReadinessField,
  type RustConstructionReadinessInput } from "./construction-readiness.js";

export function analyzeRustConstructionEffects(
  definition: RustProjectTypeDefinition,
  input: RustObjectRepresentationAnalysisInput,
  aliases: RustReceiverFieldAliasQueries,
): { readonly publishedFieldWrites: readonly Node[]; readonly deferredCaptureFields: readonly Node[] } {
  if (definition.kind !== "class") return { publishedFieldWrites: [], deferredCaptureFields: [] };
  const lineage = input.projectTypes.classLineage(definition);
  if (lineage === undefined || lineage.length > 256) throw new Error("Constructor effects require one bounded exact source lineage.");
  const layers: RustConstructionReadinessInput["layers"][number][] = [];
  for (const owner of lineage) {
    const fields: RustConstructionReadinessField[] = [];
    for (const field of input.projectTypes.externalBaseForDefinition(owner)?.fields ?? []) fields.push({
      declaration: field.declaration, absenceDefault: false, externallyInitialized: true,
    });
    for (const field of rustProjectObjectLayout(owner.declaration, input.ast)?.fields ?? []) {
      if (input.ast.hasModifierKind(field.declaration, "abstract") || aliases.aliasFor(field.declaration) !== undefined) continue;
      const initializer = sourceParameterIsProperty(input.ast, field.declaration)
        ? input.ast.name(field.declaration) : Node_Initializer(input.ast, field.declaration);
      const semantics = input.semantics.forNode(field.declaration);
      const declared = semantics.declarations.declaredValueType(field.declaration);
      const absenceDefault = initializer === undefined && declared !== undefined &&
        (semantics.types.isNullish(declared) || semantics.types.isUnion(declared) &&
          semantics.types.unionOrIntersectionTypes(declared).some(member => semantics.types.isNullish(member)));
      fields.push({ declaration: field.declaration, initializer, absenceDefault, externallyInitialized: false });
    }
    const constructor = input.ast.members(owner.declaration).find(member => member !== undefined &&
      input.ast.is.IsConstructorDeclaration(member) && input.ast.body(member) !== undefined);
    const body = constructor === undefined ? undefined : input.ast.body(constructor);
    const statements = body === undefined ? [] : input.ast.statements(body).filter((node): node is Node => node !== undefined);
    const inherited = input.projectTypes.heritageForDefinition(owner).some(edge => edge.kind === "extends" && edge.target.kind === "class") ||
      input.projectTypes.externalBaseForDefinition(owner) !== undefined;
    layers.push({ definition: owner, constructor, fields, statements: statements.slice(inherited && constructor !== undefined ? 1 : 0) });
  }
  const readiness = analyzeRustConstructionReadiness({ ast: input.ast, definition, layers,
    fields: layers.flatMap(layer => layer.fields),
    selectedField(node) {
      const semantics = input.semantics.forNode(node);
      const selection = input.ast.is.IsPropertyAccessExpression(node) ? semantics.operations.propertyAccess(node)
        : input.ast.is.IsElementAccessExpression(node) ? semantics.operations.elementAccess(node) : undefined;
      const declaration = selection?.selectedDeclaration;
      return declaration === undefined || aliases.aliasFor(declaration) !== undefined ? undefined
        : { declaration, accessMode: selection!.accessMode };
    },
    guardResult(node) {
      return selectSourceNativeGuardResult({ ast: input.ast, navigation: input.navigation,
        semanticsFor: node => input.semantics.forNode(node) }, node,
        () => undefined, () => undefined, () => undefined);
    },
    unreachable: () => false,
    mayThrow: node => input.ast.is.IsCallExpression(node) || input.ast.is.IsNewExpression(node) ||
      input.ast.is.IsPropertyAccessExpression(node) && input.semantics.forNode(node).operations.propertyAccess(node)
        ?.selectedReadDeclaration !== undefined && input.ast.is.IsGetAccessorDeclaration(
          input.semantics.forNode(node).operations.propertyAccess(node)!.selectedReadDeclaration!),
  });
  return { publishedFieldWrites: readiness.publishedFieldWrites, deferredCaptureFields: readiness.deferredCaptureFields };
}
