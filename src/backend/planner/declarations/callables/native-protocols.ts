import type { RustNativeCallableProtocol } from "../../../../analysis/callables/native-protocols.js";
import { rustNativeCallableProtocolResult } from "../../../../analysis/callables/native-protocols.js";
import type { RustItem, RustType } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { planRustNativeProducerBridge } from "./native-producer-bridges.js";
import { planRustNativeCallableMethodGenerics } from "./native-method-generics.js";

export function planRustNativeCallableProtocolItems(context: RustPlanContext): readonly RustItem[] {
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  const items: RustItem[] = [];
  for (const input of context.input.program.callableValues.native.inputs) {
    if (input.protocol.ownerFileName !== fileName) continue;
    const item = planRustNativeCallableProtocol(input.protocol, context);
    const producers = planRustNativeProducerBridge(input.protocol, context);
    if (item === undefined || producers === undefined) context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, input.subject.node),
      "rust.backend.native-callable-protocol", "An exact native callable input protocol could not be rendered."));
    else items.push(item, ...producers);
  }
  return items;
}

export function planRustNativeCallableProtocol(
  protocol: RustNativeCallableProtocol,
  context: RustPlanContext,
): RustItem | undefined {
  const signature = protocol.binding.signature;
  const parameters = protocol.method.parameters.map(parameter => rustTypeFromCarrierInContext(parameter, context, "parameter"));
  const result = rustNativeCallableProtocolResult(protocol, context.input.program.typeDefinitions);
  const returnType = result === undefined ? undefined : rustTypeFromCarrierInContext(result, context, "return");
  const methodGenerics = planRustNativeCallableMethodGenerics(protocol, context);
  if (parameters.some(parameter => parameter === undefined) || returnType === undefined || methodGenerics === undefined) return undefined;
  return { kind: "trait", name: protocol.targetName, visibility: "public",
    generics: { ...emptyRustGenerics, parameters: signature.environmentParameters.map(parameter => ({
      kind: "type", name: parameter.name, bounds: [],
    })) },
    members: [{ kind: "type", name: "InvocationError", generics: methodGenerics, bounds: [] },
      ...(protocol.completion?.futures ?? []).map(future => ({ kind: "type" as const,
        name: `AwaitError${future.ordinal}`, generics: methodGenerics, bounds: [] })),
      { kind: "function", name: "invoke", selfParam: { kind: "reference", mutable: false },
        generics: methodGenerics,
        params: (parameters as readonly RustType[]).map((type, index) => ({ name: `argument_${index}`, type })),
        returnType,
      }],
  };
}
