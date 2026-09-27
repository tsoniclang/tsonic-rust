import { inferRustTargetGenericBindings, substituteRustTargetGenerics } from "../../../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../../../target-model/types/carriers/substitution.js";
import { selectRustProviderOperation } from "../../../../policy/operations/provider-selection.js";
import { rustOperationContext } from "../../../program/walk.js";
import { providerOperationFact } from "../result.js";
import { selectedCallProviderDeclaration, selectedSourceValueCarrier } from "../operators.js";
import { checkedCallIsConstruction, selectedCallReceiverValueCarrier, selectedProviderCallGenericArguments } from "./instantiation.js";
import { mergeDirectGenericArgument, mergeGenericBindings, providerGenericParameterSet } from "./template-instantiation.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../../../program/walk.js";
import type { RustTargetConstArgument, TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";

export function resolveNativeProviderCallableArguments(
  walk: RustFactWalk,
  call: Node,
  sourceFile: SourceFile,
  resolve: (node: Node, expected: TargetTypeRef) => TargetTypeRef | undefined,
): void {
  const semantics = walk.context.semantics(sourceFile);
  const source = semantics.operations.call(call);
  if (source === undefined) return;
  const declaration = semantics.declarations.signatureDeclaration(source.selectedSignature);
  const request = { source, ...(declaration === undefined ? {} : { sourceSelectedDeclaration: declaration }) };
  const context = rustOperationContext(walk, call);
  const provider = selectedCallProviderDeclaration(request, context);
  if (provider.kind !== "selected") return;
  const operation = selectRustProviderOperation(walk.operationOptions.providerRows, provider.identity,
    checkedCallIsConstruction(request, context) ? "constructor" : "method");
  if (operation.kind !== "selected" || !operation.row.parameterCarriers?.some(carrier => carrier?.kind === "closure")) return;
  const template = providerOperationFact(operation.row);
  const parameters = template.genericParameters ?? [];
  const names = providerGenericParameterSet(parameters);
  const bindings = { types: new Map<string, TargetTypeRef>(), lifetimes: new Map<string, RustLifetimeRef>(),
    consts: new Map<string, RustTargetConstArgument>() };
  const selected = selectedProviderCallGenericArguments(request, template, context, walk.operationOptions);
  if (selected === undefined) return;
  for (const [name, argument] of selected.directGenericArguments) {
    const parameter = parameters.find(value => value.sourceName === name);
    if (parameter === undefined || !mergeDirectGenericArgument(bindings, parameter, argument)) return;
  }
  const receiver = selectedCallReceiverValueCarrier(request, context, walk.operationOptions);
  if (template.receiverCarrier !== undefined && receiver !== undefined) {
    const inferred = inferRustTargetGenericBindings(template.receiverCarrier, receiver, names);
    if (inferred === undefined || !mergeGenericBindings(bindings, inferred)) return;
  }
  for (const binding of source.sourceArgumentBindings) {
    const argument = source.sourceArguments[binding.sourceArgumentIndex];
    const pattern = template.parameterCarriers?.[binding.sourceParameterIndex];
    if (argument === undefined || pattern === undefined || pattern.kind === "closure" || binding.sourceForm !== "value") continue;
    const carrier = selectedSourceValueCarrier(argument, context, walk.operationOptions);
    if (carrier === undefined) continue;
    const inferred = inferRustTargetGenericBindings(pattern, carrier, names);
    if (inferred !== undefined && !mergeGenericBindings(bindings, inferred)) return;
  }
  for (const binding of source.sourceArgumentBindings) {
    const argument = source.sourceArguments[binding.sourceArgumentIndex]?.expression;
    const pattern = template.parameterCarriers?.[binding.sourceParameterIndex];
    if (argument === undefined || pattern?.kind !== "closure" || binding.sourceForm !== "value" ||
      !(context.ast.is.IsArrowFunction(argument) || context.ast.is.IsFunctionExpression(argument))) continue;
    const expected = substituteRustTargetGenerics(pattern, bindings.types, bindings.lifetimes, bindings.consts);
    const carrier = resolve(argument, mapRustTargetTypes(expected, type => type.kind === "type-parameter" &&
      names.typeNames.has(type.name) ? { kind: "opaque", id: "tsonic.rust.infer" } : type));
    if (carrier === undefined) continue;
    const inferred = inferRustTargetGenericBindings(pattern, carrier, names);
    if (inferred === undefined || !mergeGenericBindings(bindings, inferred)) return;
  }
}
