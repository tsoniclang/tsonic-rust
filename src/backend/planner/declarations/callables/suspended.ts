import type { RustSuspendedCallableImplementation } from "../../../../analysis/callables/suspended-values.js";
import { rustCallableProtocol } from "../../../../target-model/types/index.js";
import type { RustBlock, RustGenericParameter, RustItem, RustType } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { createRustSyntheticNameState } from "../../names/synthetic.js";
import { planRustCallableExpressionBody } from "../../expressions/callable.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustSuspendedCallableStateType } from "../../types/suspended-callables.js";
import { rustTypeParameterBounds, rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import { rustDeclarationAssociatedPredicates } from "../../types/associated-bounds.js";

export function planRustSuspendedCallableItems(context: RustPlanContext): readonly RustItem[] {
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  const items: RustItem[] = [];
  for (const implementation of context.input.program.callableValues.suspended.implementations) {
    if (implementation.sourceFileName !== fileName) continue;
    const planned = planImplementation(implementation, context);
    if (planned === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, implementation.declaration),
        "rust.backend.suspended-callable-implementation", "A suspended callable requires a complete sealed state and invocation implementation."));
    } else items.push(...planned);
  }
  return items;
}

function planImplementation(implementation: RustSuspendedCallableImplementation, context: RustPlanContext): readonly RustItem[] | undefined {
  const { declaration } = implementation;
  const scoped: RustPlanContext = { ...context, callableDeclaration: declaration,
    syntheticNames: createRustSyntheticNameState(context.input.program.source.ast, declaration, []),
  };
  const expression = planRustCallableExpressionBody(declaration, scoped);
  if (expression?.kind !== "closure" && expression?.kind !== "closure-block") return undefined;
  const ownerName = expression.params[0]?.name;
  const argumentsName = expression.params[1]?.name;
  if (expression.params.length !== 2 || ownerName === undefined || argumentsName === undefined) return undefined;
  const protocol = rustCallableProtocol(implementation.carrier);
  const callableType = rustTypeFromCarrierInContext(implementation.carrier, scoped);
  const argumentsType = protocol === undefined ? undefined : rustTypeFromCarrierInContext({ kind: "tuple", elements: protocol.parameters }, scoped);
  const resultType = callableType?.kind === "named" ? callableType.genericArguments?.[1] : undefined;
  const target = rustSuspendedCallableStateType(implementation, scoped);
  const storage = implementation.storage.map(carrier => rustTypeFromCarrierInContext(carrier, scoped));
  const requirements = context.input.program.declarationGenericRequirements.contractFor(declaration);
  if (protocol === undefined || argumentsType === undefined || resultType?.kind !== "type" || target === undefined ||
      requirements === undefined || storage.some(type => type === undefined)) return undefined;
  const parameters: RustGenericParameter[] = [];
  for (const parameter of implementation.parameters) {
    if (parameter.kind === "lifetime") {
      parameters.push({ kind: "lifetime", name: parameter.lifetime.name, outlives: parameter.outlives.map(rustLifetimeToAst) });
    } else {
      const required = [...requirements.typeParameters, ...requirements.capturedTypeParameters].find(selected => selected.name === parameter.targetName);
      parameters.push({ kind: "type", name: parameter.targetName, bounds: rustTypeParameterBounds(parameter, required?.requirements ?? []) });
    }
  }
  const environment = parameters.filter(parameter => parameter.kind === "lifetime"
    ? implementation.environment.lifetimes.some(lifetime => lifetime.name === parameter.name)
    : parameter.kind === "type" && implementation.environment.typeNames.includes(parameter.name));
  const body: RustBlock = expression.kind === "closure" ? { statements: [{ kind: "tail", expr: expression.body }] } : expression.body;
  const selfType: RustType = { kind: "named", path: "Self" };
  const state: RustType = { kind: "tuple", elements: storage as RustType[] };
  context.usedAliases?.add("rt");
  return [{ kind: "struct", name: implementation.stateName, visibility: "crate",
    generics: { parameters: environment, wherePredicates: [] }, fields: [{ name: "state", type: state, visibility: "crate" }, {
      name: "owner", type: { kind: "named", path: "alloc::rc::Weak", genericArguments: [{ kind: "type", type: selfType }] }, visibility: "crate",
    }],
  }, { kind: "impl", target,
    generics: rustGenericsWithAssociatedBounds(parameters, rustDeclarationAssociatedPredicates(declaration, scoped)),
    trait: { kind: "named", path: "rt::CallableImplementation", genericArguments: [{ kind: "type", type: argumentsType }, resultType] },
    members: [{ kind: "function", name: "invoke", visibility: "private", selfParam: { kind: "reference", mutable: false },
      generics: { parameters: [], wherePredicates: [] }, params: [{ name: argumentsName, type: argumentsType }], returnType: resultType.type,
      body: { statements: [{ kind: "let", name: ownerName, mutable: false, init: {
        kind: "method-call", receiver: { kind: "method-call", receiver: {
          kind: "field", receiver: { kind: "path", path: "self" }, name: "owner",
        }, method: "upgrade", args: [] }, method: "expect", args: [{ kind: "str-literal", value: "an invoked callable has a live owner" }],
      } }, ...body.statements] },
    }],
  }];
}
