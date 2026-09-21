import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../model/context.js";
import type { RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";

export function rustProjectGenericParameters(
  declaration: Node,
  context: Pick<RustSourcePolicyContext, "ast" | "sourceLifetimes" | "semanticsFor">,
): readonly RustSourceGenericParameterContract[] | undefined {
  const own = context.sourceLifetimes.contractFor(declaration)?.parameters ?? [];
  if ((context.ast.kindName(declaration) !== "KindClassDeclaration" && context.ast.kindName(declaration) !== "KindClassExpression") ||
    context.ast.parent(declaration) === context.ast.getSourceFile(declaration)) return own;
  const semantics = context.semanticsFor(declaration);
  const type = semantics.declarations.declaredType(declaration);
  const bindings = type === undefined ? undefined : semantics.types.typeArgumentBindings(type);
  if (bindings === undefined) return undefined;
  const local = bindings.filter(binding => binding.scope === "local");
  if (local.length !== own.length || local.some((binding, index) => binding.declaration !== own[index]?.declaration)) {
    return undefined;
  }
  const parameters = bindings.map(binding => context.sourceLifetimes.parameterFor(binding.declaration));
  if (parameters.some(parameter => parameter === undefined)) return undefined;
  const exact = parameters as readonly RustSourceGenericParameterContract[];
  const names = exact.map(parameter => parameter.kind === "type" ? parameter.targetName : parameter.lifetime.name);
  return new Set(names).size === names.length ? Object.freeze([...exact]) : undefined;
}
