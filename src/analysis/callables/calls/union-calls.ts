import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustUnionCallProducer } from "../../program/records/union-calls.js";
import type { RustConversionEmissionProducer } from "../../program/records/conversion-emission.js";
import { rustMemberAccessReceiver } from "../../../target-model/syntax/expressions.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTargetGenericBindingsForArguments, substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { substituteRustValueConversion } from "../../../target-model/conversions/substitution.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { admitRustConversionEmission } from "../../conversions/emission.js";

export function analyzeRustUnionCalls(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[],
  producer: RustUnionCallProducer, conversions: RustConversionEmissionProducer): void {
  for (const node of nodes) {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "source-call" || fact.target.form !== "union-method") continue;
    const target = fact.target;
    const callee = program.source.ast.as.AsCallExpression(node)?.Expression;
    const receiver = rustMemberAccessReceiver(program.source.ast, callee);
    const variants = program.typeDefinitions.sourceUnionVariants(target.receiverCarrier);
    const call = program.records.selectedCall.get(node);
    const selected = call?.sourceUnionMethods;
    const substitutions = call === undefined ? undefined : rustTargetGenericBindingsForArguments(call.member.genericParameters ?? [], fact.targetGenericArguments ?? []);
    const effects = program.records.sourceCallEffects.get(node);
    if (receiver === undefined || variants === undefined || selected === undefined || substitutions === undefined || effects?.unionBranches === undefined ||
      target.variants.length !== variants.length || target.variants.length !== selected.variants.length || target.variants.length !== effects.unionBranches.length ||
      !rustTargetTypeRefEquals(selected.receiverCarrier, target.receiverCarrier))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted source union call requires its exact selected branch inventory and invocation ABI.", node);
    for (const [index, method] of target.variants.entries()) {
      const variant = variants[index]!;
      const selection = selected.variants[index]!;
      const result = substituteRustTargetGenerics(selection.returnType, substitutions.types, substitutions.lifetimes, substitutions.consts, program.typeFamilies.normalize);
      const conversion = selection.resultConversion === undefined ? undefined
        : substituteRustValueConversion(selection.resultConversion, substitutions.types, substitutions.lifetimes, substitutions.consts);
      if (variant.name !== method.name || !rustTargetTypeRefEquals(variant.carrier, method.carrier) || selection.declaration !== method.declaration ||
        selection.targetName !== method.targetName || selection.name !== method.name || !rustTargetTypeRefEquals(selection.carrier, method.carrier) ||
        !rustTargetTypeRefEquals(result, method.returnType) || !closedMetadataEquals(conversion, method.resultConversion))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted union method requires its exact native specialization and return conversion.", node);
      const contract = method.resultConversion === undefined ? undefined : admitRustConversionEmission(conversions, method.resultConversion, program.typeDefinitions);
      if (contract === undefined ? !rustTargetTypeRefEquals(method.returnType, fact.resultCarrier)
        : contract.fallible || !rustTargetTypeRefEquals(contract.source, method.returnType) || !rustTargetTypeRefEquals(contract.target, fact.resultCarrier))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted union method requires its exact infallible result conversion.", node);
    }
    producer.publish(node, { receiver, target, mutable: target.variants.some(variant => variant.mutatesSelf),
      fallible: Object.freeze(effects.unionBranches.map(branch => branch.invocation === "fallible")) });
  }
}
