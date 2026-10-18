import type { RustNativeCallableProtocol } from "../../../../analysis/callables/native-protocols.js";
import { rustNativeCallableProtocolResult } from "../../../../analysis/callables/native-protocols.js";
import type { RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { planRustNativeProducerBridge } from "./native-producer-bridges.js";
import { planRustNativeCallableMethodGenerics } from "./native-method-generics.js";
import { planRustNativeGenericProducerBridges } from "./native-generic-producers.js";
import { rustJsPromiseOutputTargetType } from "../../../../target-model/types/carriers/promises.js";

export function planRustNativeCallableProtocolItems(context: RustPlanContext): readonly RustItem[] {
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  const items: RustItem[] = [];
  for (const protocol of context.input.program.callableValues.native.protocols) {
    const generic = planRustNativeGenericProducerBridges(protocol, context);
    if (generic === undefined) context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, context.sourceFile),
      "rust.backend.native-callable-protocol", "An exact native generic producer implementation could not be rendered."));
    else items.push(...generic);
    if (protocol.ownerFileName === fileName) {
      const item = planRustNativeCallableProtocol(protocol, context);
      const producers = planRustNativeProducerBridge(protocol, context);
      if (item === undefined || producers === undefined) context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, context.sourceFile),
        "rust.backend.native-callable-protocol", "An exact native callable input protocol could not be rendered."));
      else items.push(item, ...producers);
    }
  }
  return items;
}

export function planRustNativeCallableProtocol(
  protocol: RustNativeCallableProtocol,
  enclosingContext: RustPlanContext,
): RustItem | undefined {
  const context: RustPlanContext = { ...enclosingContext, typeParameterNames: new Map([
    ...enclosingContext.typeParameterNames ?? [], [protocol.implicitSelf.identity, protocol.implicitSelf.name],
  ]) };
  const signature = protocol.signature;
  const parameters = protocol.method.parameters.map(parameter => rustTypeFromCarrierInContext(parameter, context, "parameter"));
  const result = rustNativeCallableProtocolResult(protocol, context.input.program.typeDefinitions);
  const returnType = result === undefined ? undefined : rustTypeFromCarrierInContext(result, context, "return");
  const methodGenerics = planRustNativeCallableMethodGenerics(protocol, context);
  const invoked = context.input.program.callableValues.nativeDispatch.requiredFor(protocol);
  if (parameters.some(parameter => parameter === undefined) || returnType === undefined || methodGenerics === undefined) return undefined;
  return { kind: "trait", name: protocol.targetName, visibility: "public",
    generics: { ...emptyRustGenerics, parameters: signature.environmentParameters.map(parameter => ({
      kind: "type", name: parameter.name, bounds: [],
    })) },
    members: [{ kind: "type", name: "InvocationError", generics: methodGenerics, bounds: [] },
      ...(protocol.completion?.futures ?? []).filter(future => rustJsPromiseOutputTargetType(future.carrier) === undefined)
        .map(future => ({ kind: "type" as const,
          name: `AwaitError${future.ordinal}`, generics: methodGenerics, bounds: [] })),
      ...(invoked ? [{ kind: "function" as const, name: "invoke", selfParam: { kind: "reference" as const, mutable: false },
        generics: methodGenerics,
        params: (parameters as readonly RustType[]).map((type, index) => ({ name: `argument_${index}`, type })),
        returnType,
      }] : [])],
  };
}
