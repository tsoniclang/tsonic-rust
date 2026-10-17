import type { RustCompilerFunction, RustCompilerType } from "../model/model.js";
import { rustCompilerTypeSemanticKey } from "../model/rustdoc-types.js";
import type { RustNativeResultLoanContract } from "../../../target-model/operations/result-loans.js";
import { compilerFunctionResult } from "./representability.js";

export function projectRustNativeResultLoans(
  fn: RustCompilerFunction, valueType: RustCompilerType,
): RustNativeResultLoanContract {
  const selected = compilerFunctionResult(fn.result);
  if (selected.type !== valueType) throw new Error("Native result-loan projection requires its original selected result type.");
  const contract = fn.resultLoans;
  if (!selected.fallible) return contract;
  return Object.freeze({ ...contract, valueTypeIdentity: rustCompilerTypeSemanticKey(valueType),
    loans: Object.freeze(contract.loans.filter(loan => loan.resultPath[0] === "argument:0").map(loan =>
      Object.freeze({ ...loan, resultPath: Object.freeze(loan.resultPath.slice(1)) }))),
  });
}

export function projectRustNativeExplicitReceiverResultLoans(contract: RustNativeResultLoanContract): RustNativeResultLoanContract {
  return Object.freeze({ ...contract, loans: Object.freeze(contract.loans.map(loan => Object.freeze({ ...loan,
    origins: Object.freeze(loan.origins.map(origin => Object.freeze({ ...origin,
      input: Object.freeze({ kind: "argument" as const,
        sourceIndex: origin.input.kind === "receiver" ? 0 : origin.input.sourceIndex + 1 }),
    }))),
  }))) });
}
