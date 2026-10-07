import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../model/context.js";
import type { RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";

export function rustProjectGenericContractCorrespondence(
  selectedDeclaration: Node,
  implementationDeclaration: Node,
  context: Pick<RustSourcePolicyContext, "ast" | "sourceLifetimes">,
): { readonly selected: readonly RustSourceGenericParameterContract[];
  readonly implementation: readonly RustSourceGenericParameterContract[] } | undefined {
  const contractFor = (declaration: Node): readonly RustSourceGenericParameterContract[] | undefined => {
    const syntax = context.ast.typeParameters(declaration);
    const contract = syntax.length === 0 ? Object.freeze([]) : context.sourceLifetimes.contractFor(declaration)?.parameters;
    return contract !== undefined && contract.length === syntax.length && contract.every((parameter, index) =>
      parameter.declaration === syntax[index]) ? contract : undefined;
  };
  const selected = contractFor(selectedDeclaration);
  const implementation = selectedDeclaration === implementationDeclaration ? selected : contractFor(implementationDeclaration);
  return selected === undefined || implementation === undefined || selected.length !== implementation.length ||
    selected.some((parameter, index) => parameter.kind !== implementation[index]?.kind)
    ? undefined : Object.freeze({ selected, implementation });
}

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
  const identities = exact.map(parameter => parameter.kind === "type" ? parameter.identity : parameter.lifetime.identity);
  return new Set(identities).size === identities.length ? Object.freeze([...exact]) : undefined;
}
