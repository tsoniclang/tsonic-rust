import type { Node } from "@tsonic/tsts";
import {
  Node_Initializer,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustSliceElementCarrier,
} from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type {
  RustArgumentMode,
  RustSourceParameterContract,
} from "../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustSourceTypeContractFactKey } from "../../source/semantics/facts.js";
import { resolveRustTargetTypeRef } from "../types/resolution.js";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "../types/resolution.js";

export interface RustSourceCallableAbiResolver {
  resolveParameterAbi(
    parameter: Node,
    context: RustTargetTypeResolutionContext,
    options: RustTargetTypeResolutionOptions,
  ): RustSourceParameterAbi | undefined;
}

export interface RustSourceParameterAbi {
  readonly form: "required" | "optional" | "default" | "rest";
  readonly sourceContract: RustSourceParameterContract;
  readonly valueCarrier: TargetTypeRef;
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
}

export function rustSourceParameterContractCarrier(
  abi: RustSourceParameterAbi,
): TargetTypeRef {
  return abi.parameterCarrier.kind === "reference"
    ? abi.parameterCarrier.target
    : abi.parameterCarrier;
}

export function rustSourceOwnershipContractForType(
  typeNode: Node | undefined,
  context: RustTargetTypeResolutionContext,
): RustSourceParameterContract {
  if (typeNode === undefined) return "ordinary";
  const contract = context.facts.resolve(typeNode, rustSourceTypeContractFactKey) ??
    context.facts.get(typeNode, rustSourceTypeContractFactKey);
  return contract?.kind === "owned" ||
      contract?.kind === "shared-reference" ||
      contract?.kind === "mutable-reference"
    ? contract.kind
    : "ordinary";
}

export function createRustSourceCallableAbiResolver(): RustSourceCallableAbiResolver {
  const cache = new WeakMap<object, RustSourceParameterAbi | null>();
  return Object.freeze<RustSourceCallableAbiResolver>({
    resolveParameterAbi(parameter, context, options) {
      const cached = cache.get(parameter);
      if (cached !== undefined) return cached ?? undefined;
      const typeNode = Node_Type(context.ast, parameter);
      const carrier = resolveRustTargetTypeRef(typeNode ?? parameter, context, options);
      const form = rustParameterForm(parameter, context);
      if (carrier === undefined || form === undefined) {
        cache.set(parameter, null);
        return undefined;
      }
      const sourceContract = rustSourceOwnershipContractForType(typeNode, context);
      const abi = explicitParameterAbi(form, carrier, sourceContract);
      cache.set(parameter, abi ?? null);
      return abi;
    },
  });
}

export function resolveRustContextualParameterAbi(
  parameter: Node,
  selectedParameterCarrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): RustSourceParameterAbi | undefined {
  const form = rustParameterForm(parameter, context);
  if (form === undefined) return undefined;
  const authoredType = Node_Type(context.ast, parameter);
  const authoredCarrier = resolveRustTargetTypeRef(
    authoredType ?? parameter,
    context,
    options,
  );
  const selectedValueCarrier = form === "optional"
    ? rustOptionElementCarrier(selectedParameterCarrier)
    : form === "default"
      ? rustOptionElementCarrier(selectedParameterCarrier)
      : selectedParameterCarrier.kind === "reference"
        ? authoredCarrier
        : selectedParameterCarrier;
  if (selectedValueCarrier === undefined) return undefined;
  if (authoredType !== undefined && authoredCarrier !== undefined &&
    !rustTargetTypeRefEquals(authoredCarrier, selectedValueCarrier)) {
    return undefined;
  }
  const mode = form === "required"
    ? rustParameterModeForCarriers(selectedValueCarrier, selectedParameterCarrier)
    : "value";
  return mode === undefined
    ? undefined
    : Object.freeze({
        form,
        sourceContract: "ordinary",
        valueCarrier: selectedValueCarrier,
        parameterCarrier: selectedParameterCarrier,
        mode,
      });
}

function explicitParameterAbi(
  form: RustSourceParameterAbi["form"],
  carrier: TargetTypeRef,
  contract: RustSourceParameterContract,
): RustSourceParameterAbi | undefined {
  if (contract === "shared-reference" || contract === "mutable-reference") {
    if (form !== "required" || carrier.kind !== "reference" ||
      carrier.mutable !== (contract === "mutable-reference")) {
      return undefined;
    }
    return Object.freeze({
      form,
      sourceContract: contract,
      valueCarrier: carrier.target,
      parameterCarrier: carrier,
      mode: carrier.mutable ? "mut-ref" : "ref",
    });
  }
  const sourceContract = contract;
  if (form === "optional") {
    const option = rustOptionTargetType(carrier);
    return Object.freeze({
      form,
      sourceContract,
      valueCarrier: option,
      parameterCarrier: option,
      mode: "value",
    });
  }
  if (form === "default") {
    return Object.freeze({
      form,
      sourceContract,
      valueCarrier: carrier,
      parameterCarrier: rustOptionTargetType(carrier),
      mode: "value",
    });
  }
  return Object.freeze({
    form,
    sourceContract,
    valueCarrier: carrier,
    parameterCarrier: carrier,
    mode: "value",
  });
}

function rustParameterModeForCarriers(
  valueCarrier: TargetTypeRef,
  parameterCarrier: TargetTypeRef,
): RustArgumentMode | undefined {
  if (rustTargetTypeRefEquals(valueCarrier, parameterCarrier)) return "value";
  if (parameterCarrier.kind !== "reference" ||
    !rustTargetTypeRefEquals(parameterCarrier.target, valueCarrier) &&
    !(valueCarrier.kind === "sequence" &&
      rustTargetTypeRefEquals(rustSliceElementCarrier(parameterCarrier), valueCarrier.element))) {
    return undefined;
  }
  return parameterCarrier.mutable ? "mut-ref" : "ref";
}

function rustParameterForm(
  parameter: Node,
  context: RustTargetTypeResolutionContext,
): RustSourceParameterAbi["form"] | undefined {
  const declaration = context.ast.as.AsParameterDeclaration(parameter);
  if (declaration === undefined) return undefined;
  return declaration.DotDotDotToken !== undefined
    ? "rest"
    : Node_Initializer(context.ast, parameter) !== undefined
      ? "default"
      : context.ast.questionToken(parameter) !== undefined
        ? "optional"
        : "required";
}
