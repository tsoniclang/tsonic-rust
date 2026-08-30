import type {
  RustFinalizedOperationAbi,
  RustFinalizedTargetInput,
  RustFinalizedValueConversion,
} from "../facts/finalized-operation-abi.js";
import {
  isRustFinalizedArrayInput,
  isRustFinalizedSliceInput,
  isRustFinalizedSourceInput,
  isRustFinalizedTaggedArrayInput,
} from "../facts/finalized-operation-abi.js";
import type {
  RustProviderOperationForm,
  RustValueConversion,
} from "../../target-model/operations/model.js";
import type {
  RustTargetGenericArgument,
  RustTargetTypeRef,
} from "../../target-model/types/model.js";
import type { RustFoundation } from "../../target-model/foundation/model.js";
import { maximumRustFoundation } from "../../target-model/foundation/model.js";
import {
  rustValueConversionContract,
  type RustValueConversionContract,
} from "../../target-model/conversions/contracts.js";
import {
  rustFoundationForCarrier,
  rustFoundationForPath,
} from "./requirements.js";

export function rustFoundationForValueConversion(
  conversion: RustValueConversion,
): RustFoundation {
  const contract = rustValueConversionContract(conversion);
  if (contract === undefined) {
    throw new Error("A finalized Rust value conversion has no valid lowering contract.");
  }
  return rustFoundationForConversionContract(contract);
}

export function rustFoundationForFinalizedOperationAbi(
  abi: RustFinalizedOperationAbi,
): RustFoundation {
  let foundation = rustFoundationForProviderOperationForm(abi.target);
  const require = (candidate: RustFoundation): void => {
    foundation = maximumRustFoundation(foundation, candidate);
  };
  if (abi.sourceReceiver.kind === "receiver") {
    require(rustFoundationForCarrier(abi.sourceReceiver.carrier));
  }
  for (const argument of abi.sourceArguments) {
    require(rustFoundationForCarrier(argument.carrier));
  }
  if (abi.targetReceiver.kind === "input") {
    require(rustFoundationForFinalizedTargetInput(abi.targetReceiver.input));
  }
  for (const input of abi.targetArguments) {
    require(rustFoundationForFinalizedTargetInput(input));
  }
  for (const argument of abi.targetGenericArguments) {
    require(rustFoundationForGenericArgument(argument));
  }
  if (abi.result.kind === "sync") {
    require(rustFoundationForCarrier(abi.result.rawCarrier));
    require(rustFoundationForFinalizedConversion(abi.result.conversion));
    require(rustFoundationForCarrier(abi.result.carrier));
  } else {
    require(rustFoundationForCarrier(abi.result.futureCarrier));
    require(rustFoundationForCarrier(abi.result.awaitedRawCarrier));
    require(rustFoundationForFinalizedConversion(abi.result.awaitedConversion));
    require(rustFoundationForCarrier(abi.result.awaitedCarrier));
  }
  if (abi.effects.errorCarrier !== undefined) {
    require(rustFoundationForCarrier(abi.effects.errorCarrier));
  }
  return foundation;
}

function rustFoundationForConversionContract(
  contract: RustValueConversionContract,
): RustFoundation {
  let foundation = maximumRustFoundation(
    rustFoundationForCarrier(contract.source),
    rustFoundationForCarrier(contract.target),
  );
  const require = (candidate: RustFoundation): void => {
    foundation = maximumRustFoundation(foundation, candidate);
  };
  switch (contract.lowering) {
    case "call":
      require(rustFoundationForPath(contract.path));
      break;
    case "option-map":
      require(rustFoundationForConversionContract(contract.element));
      break;
    case "js-value-from-option":
    case "js-value-from-array":
      require(rustFoundationForCarrier(contract.element));
      require(rustFoundationForConversionContract(contract.elementConversion));
      break;
    case "js-value-from-source-union":
      for (const variant of contract.variants) {
        require(rustFoundationForCarrier(variant.carrier));
        require(rustFoundationForConversionContract(variant.conversion));
      }
      break;
    case "js-value-from-structural-to-json":
      require(rustFoundationForCarrier(contract.resultCarrier));
      require(rustFoundationForConversionContract(contract.resultConversion));
      break;
    case "js-value-from-structural-object":
      for (const field of contract.fields) {
        require(rustFoundationForCarrier(field.sourceCarrier));
        require(rustFoundationForConversionContract(field.conversion));
      }
      break;
    case "numeric-cast":
    case "identity":
    case "source-union-variant":
    case "option-some":
    case "js-argument-vector-callback":
    case "owned-string-from-borrowed-str":
    case "copy-from-reference":
      break;
  }
  return foundation;
}

function rustFoundationForFinalizedConversion(
  conversion: RustFinalizedValueConversion,
): RustFoundation {
  let foundation = maximumRustFoundation(
    rustFoundationForCarrier(conversion.sourceCarrier),
    rustFoundationForCarrier(conversion.targetCarrier),
  );
  if (conversion.kind === "semantic") {
    foundation = maximumRustFoundation(
      foundation,
      rustFoundationForValueConversion(conversion.conversion),
    );
  }
  return foundation;
}

function rustFoundationForFinalizedTargetInput(
  input: RustFinalizedTargetInput,
): RustFoundation {
  let foundation: RustFoundation = "core";
  const require = (candidate: RustFoundation): void => {
    foundation = maximumRustFoundation(foundation, candidate);
  };
  if (isRustFinalizedSourceInput(input)) {
    require(rustFoundationForCarrier(input.sourceCarrier));
    require(rustFoundationForFinalizedConversion(input.conversion));
    require(rustFoundationForCarrier(input.parameterCarrier));
  } else if (isRustFinalizedSliceInput(input)) {
    input.elements.forEach((element) => {
      require(rustFoundationForFinalizedTargetInput(element));
    });
    require(rustFoundationForCarrier(input.elementCarrier));
    require(rustFoundationForCarrier(input.parameterCarrier));
  } else if (isRustFinalizedArrayInput(input)) {
    input.elements.forEach((element) => {
      require(rustFoundationForFinalizedTargetInput(element));
    });
    require(rustFoundationForCarrier(input.elementCarrier));
  } else if (isRustFinalizedTaggedArrayInput(input)) {
    input.elements.forEach((element) => {
      require(rustFoundationForFinalizedTargetInput(element.input));
      require(rustFoundationForPath(element.constructorPath));
    });
    require(rustFoundationForCarrier(input.elementCarrier));
  }
  return foundation;
}

function rustFoundationForProviderOperationForm(
  form: RustProviderOperationForm,
): RustFoundation {
  let foundation: RustFoundation = "core";
  const require = (candidate: RustFoundation): void => {
    foundation = maximumRustFoundation(foundation, candidate);
  };
  const requireCarrier = (carrier: RustTargetTypeRef): void => {
    require(rustFoundationForCarrier(carrier));
  };
  const requireConversion = (conversion: RustValueConversion | undefined): void => {
    if (conversion !== undefined) require(rustFoundationForValueConversion(conversion));
  };
  const requireGenericArgument = (argument: RustTargetGenericArgument): void => {
    require(rustFoundationForGenericArgument(argument));
  };
  switch (form.form) {
    case "marker":
    case "method":
    case "arg-method":
    case "field":
      break;
    case "call":
      require(rustFoundationForPath(form.path));
      form.argConversions?.forEach(requireConversion);
      break;
    case "source-module-construction":
      require(rustFoundationForPath(form.path));
      require(rustFoundationForPath(form.bootstrap.path));
      if (form.bootstrap.errorCarrier !== undefined) {
        requireCarrier(form.bootstrap.errorCarrier);
      }
      form.argConversions?.forEach(requireConversion);
      break;
    case "struct-variant":
    case "expression-macro":
    case "call-c-variadic":
    case "call-str-slice":
    case "free-call-str-slice":
    case "path":
    case "reference-path":
    case "static":
      require(rustFoundationForPath(form.path));
      break;
    case "call-value-slice":
    case "call-value-array":
      require(rustFoundationForPath(form.path));
      form.leadingArguments.forEach((argument) => requireCarrier(argument.carrier));
      requireCarrier(form.elementCarrier);
      break;
    case "receiver-value-array":
      form.leadingArguments.forEach((argument) => requireCarrier(argument.carrier));
      requireCarrier(form.elementCarrier);
      break;
    case "receiver-tagged-array":
      form.leadingArguments.forEach((argument) => requireCarrier(argument.carrier));
      requireCarrier(form.elementCarrier);
      form.alternatives.forEach((alternative) => {
        requireCarrier(alternative.inputCarrier);
        require(rustFoundationForPath(alternative.constructorPath));
      });
      break;
    case "arg-receiver-method":
    case "arg-structural-method":
      form.argConversions?.forEach(requireConversion);
      break;
    case "index":
      requireConversion(form.indexConversion);
      break;
    case "free-call":
      require(rustFoundationForPath(form.path));
      form.argConversions?.forEach(requireConversion);
      break;
    case "binary-operator":
      require(rustFoundationForPath(form.trait));
      break;
    case "trait-call":
    case "trait-associated-value":
      requireCarrier(form.owner);
      require(rustFoundationForPath(form.traitPath));
      form.traitGenericArguments.forEach(requireGenericArgument);
      break;
    case "associated-value":
      requireCarrier(form.owner);
      break;
    case "receiver-method":
      form.argConversions?.forEach(requireConversion);
      break;
  }
  return foundation;
}

function rustFoundationForGenericArgument(
  argument: RustTargetGenericArgument,
): RustFoundation {
  return argument.kind === "type"
    ? rustFoundationForCarrier(argument.type)
    : "core";
}
