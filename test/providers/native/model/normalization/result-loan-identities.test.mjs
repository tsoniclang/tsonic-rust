import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFunction } from "../../../../../dist/providers/native/model/normalization/functions.js";
import { rustCompilerTypeSemanticKey } from "../../../../../dist/providers/native/model/rustdoc-types.js";

const dependency = { alias: "loan_fixture", packageId: "loan_fixture 1", packageName: "loan_fixture", packageVersion: "1",
  crateName: "loan_fixture", targetCrateName: "loan_fixture", manifestPath: "/loan_fixture/Cargo.toml",
  sourceRoot: "/loan_fixture", sourceDigest: "test", closurePackageIds: ["loan_fixture 1"], features: [] };
const identity = itemId => ({ itemId, canonicalPath: ["loan_fixture", itemId] });
const owner = identity("Token");
const lifetime = { kind: "parameter", identity: identity("Token::owner"), name: "owner" };
const token = { kind: "path", identity: owner, crateName: "loan_fixture", modulePath: [], name: "Token",
  genericArguments: [{ kind: "lifetime", lifetime }] };
const inherited = [{ kind: "lifetime", lifetime, outlives: [] }];

function normalized(receiver, result, options = {}) {
  const item = { id: 1, name: "forward", inner: { function: {
    sig: { inputs: [["self", receiver]], output: result, is_c_variadic: false },
    header: { is_async: false, is_unsafe: false, abi: "Rust" },
    generics: { params: [], where_predicates: [] },
  } } };
  const document = { index: { 1: item }, paths: { 1: { path: ["loan_fixture", "Token", "forward"], kind: "function" } } };
  return normalizeFunction(document, item, dependency, true, { selfOwner: owner, selfType: token,
    inheritedGenericParameters: inherited, ...options });
}

test("normalization retains the actual owned Self type and inherited binder in one result relation", () => {
  const selected = normalized({ generic: "Self" }, { generic: "Self" });
  assert.equal(selected.receiver.kind, "value", "raw native receiver mode survives Self substitution");
  assert.equal(selected.receiver.type === token, true, "the original normalized impl Self evidence is retained");
  assert.equal(selected.result === token, true, "the same actual Self substitution supplies the native result");
  assert.equal(selected.resultLoans.kind, "complete", "the declared inherited lifetime correspondence is complete");
  assert.equal(selected.resultLoans.loans.length, 1, "one actual result lifetime parameter");
  const origin = selected.resultLoans.loans[0].origins[0];
  assert.equal(origin.kind, "carried", "an owned Self carries an existing loan, not a borrow of Self storage");
  assert.equal(origin.input.kind, "receiver", "the normalized source receiver identity remains authoritative");
  assert.equal(origin.inputType, rustCompilerTypeSemanticKey(token), "the native type identity is not a synthetic receiver label");
  assert.equal(origin.inputPath[0], "argument:0", "the original owner lifetime argument retains its exact position");
  assert.equal(Object.hasOwn(selected, "borrowedResult"), false, "an owned result receives no borrowed-result compatibility projection");
});

test("a borrowed Self retains both the real outer borrow and the owned owner's distinct carried lifetime", () => {
  const selected = normalized({ borrowed_ref: { lifetime: null, is_mutable: false, type: { generic: "Self" } } },
    { generic: "Self" });
  assert.equal(selected.receiver.kind, "shared", "the selected receiver is a shared native reference");
  assert.equal(selected.receiver.type.kind, "reference", "the whole normalized receiver type is retained");
  assert.equal(selected.receiver.type.target === token, true, "the native owner referent is not erased");
  const origins = selected.resultLoans.loans[0].origins;
  assert.equal(origins.length, 1, "the unrelated anonymous receiver borrow is not conflated with the owner's binder");
  assert.equal(origins[0].kind, "carried", "the existing inner loan is carried through the reference");
  assert.equal(origins[0].inputPath.join("/"), "referent/argument:0", "the exact inner borrowed owner path is retained");
});

test("an unresolved trait Self stays unavailable rather than inventing an owned type's lifetime arguments", () => {
  const selected = normalized({ generic: "Self" }, { generic: "Self" }, { selfType: undefined });
  assert.equal(selected.receiver.type.kind, "self", "the original declared trait Self identity is preserved");
  assert.equal(selected.receiver.type.owner === owner, true, "the exact native Self owner remains available for later instantiation");
  assert.equal(selected.resultLoans.kind, "unavailable", "uninstantiated Self is not claimed loan-free");
  assert.equal(selected.resultLoans.loans.length, 0, "no owner lifetime is guessed from spelling");
  assert.equal(selected.resultLoans.reasons.length > 0, true, "the actual missing instantiation is explicit");
});

test("the result-loan selector publishes the same actual typed elided binder without a second lifetime inference", () => {
  const selected = normalized({ borrowed_ref: { lifetime: null, is_mutable: false, type: { generic: "Self" } } },
    { borrowed_ref: { lifetime: null, is_mutable: false, type: { primitive: "u8" } } });
  assert.equal(selected.resultLoans.kind, "complete", "the original receiver establishes native elision");
  const relation = selected.resultLoans.loans.find(loan => loan.resultPath.join("/") === "reference");
  assert.equal(relation !== undefined, true, "the result retains its actual reference position");
  const lifetime = selected.resultLoanTypes.lifetimes.find(row => row.key === relation.lifetime)?.lifetime;
  assert.equal(lifetime !== undefined, true, "the sole selector retains the exact typed binder as data");
  assert.equal(selected.resultLoanTypes.result.kind, "reference", "typed result shape remains native");
  assert.equal(selected.resultLoanTypes.result.lifetime === lifetime, true,
    "query acquisition consumes the selector's identical binder, never reparses a lifetime name");
  assert.equal(selected.result.kind, "reference", "the originally normalized declaration remains distinct");
  assert.equal(selected.resultLoanTypes.result.target === selected.result.target, true,
    "normalization does not replace unrelated native type identity");
});
