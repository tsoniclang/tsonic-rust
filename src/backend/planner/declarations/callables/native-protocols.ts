import type { RustNativeCallableProtocol } from "../../../../target-model/records/native/native-protocols.js";
import type { RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { planRustNativeProducerBridge } from "./native-producer-bridges.js";
import { planRustNativeCallableMethodGenerics } from "./native-method-generics.js";
import { planRustNativeProtocolObligations } from "./native-protocol-obligations.js";
import { planRustNativeGenericProducerBridges } from "./native-generic-producers.js";
import { rustGenericCallableEnvironmentGenerics } from "./generic-signatures.js";

export function planRustNativeCallableProtocolItems(context: RustPlanContext): readonly RustItem[] {
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  const items: RustItem[] = [];
  const protocols = context.input.program.records.nativeProtocols.get(context.sourceFile);
  if (protocols === undefined) failRustPlannerInvariant("A native source file requires its sealed callable protocol inventory.", context.sourceFile);
  for (const protocol of protocols) {
    const generic = planRustNativeGenericProducerBridges(protocol, context);
    if (generic === undefined) failRustPlannerInvariant("An admitted native generic producer requires its rendered implementation.", context.sourceFile);
    items.push(...generic);
    if (protocol.ownerFileName === fileName) {
      const item = planRustNativeCallableProtocol(protocol, context);
      const producers = planRustNativeProducerBridge(protocol, context);
      if (producers === undefined) failRustPlannerInvariant("An admitted native callable protocol requires its rendered producer bridge.", context.sourceFile);
      items.push(item, ...producers);
    }
  }
  return items;
}

export function planRustNativeCallableProtocol(
  protocol: RustNativeCallableProtocol,
  context: RustPlanContext,
): RustItem {
  const parameters = protocol.method.parameters.map(parameter => rustTypeFromCarrierInContext(parameter, context, "parameter"));
  const returnType = rustTypeFromCarrierInContext(protocol.result, context, "return");
  const methodGenerics = planRustNativeCallableMethodGenerics(protocol, context);
  const emission = context.input.program.records.nativeProtocol.get(protocol);
  if (emission === undefined) failRustPlannerInvariant("An admitted native callable protocol requires its sealed dispatch demand.");
  const { invoked } = emission;
  if (parameters.some(parameter => parameter === undefined) || returnType === undefined)
    failRustPlannerInvariant("An admitted native callable protocol requires its renderable method signature.");
  return { kind: "trait", name: protocol.targetName, visibility: "public",
    generics: { ...rustGenericCallableEnvironmentGenerics(protocol.environmentParameters, context),
      wherePredicates: planRustNativeProtocolObligations(protocol, context) },
    members: [{ kind: "type", name: "InvocationError", generics: methodGenerics, bounds: [] },
      ...emission.nativeFutures
        .map(future => ({ kind: "type" as const,
          name: `AwaitError${future.ordinal}`, generics: methodGenerics, bounds: [] })),
      ...(invoked ? [{ kind: "function" as const, name: "invoke", selfParam: { kind: "reference" as const, mutable: false },
        generics: methodGenerics,
        params: (parameters as readonly RustType[]).map((type, index) => ({ name: `argument_${index}`, type })),
        returnType,
      }] : [])],
  };
}
