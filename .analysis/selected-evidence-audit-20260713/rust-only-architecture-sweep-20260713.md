# Rust Selected-Evidence Architecture Sweep

## Scope

This audit covers Rust-owned product code only:

- `src/source/rust-target-semantics/**`
- `src/source/provider-packages/**`
- `src/backend/**`

The audit classifies every current checker query and every current occurrence of the adjacent reconstruction patterns requested by the architecture review. It does not classify C#, shared Tsonic, TSTS, Python, or GPU code.

## Governing Boundary

Rust may prove selected source-operation identity only from TSTS request evidence, TSTS finalized facts, provider virtual declaration facts, source-profile declarations selected by TSTS, or Rust target facts derived from that evidence. Rust does not re-ask the checker which call, member, signature, overload, element access, conversion, or operator was selected.

Post-check type queries are a separate contract. They may map an already-selected compiler type or an authored type reference to a closed Rust carrier, but they may not select an operation, recover a provider member, swallow checker failures, or fall through to spelling-based target selection.

## Classification

| Class | Meaning |
| --- | --- |
| Selected-evidence compliant | Consumes selected request/fact provenance and does not rediscover identity. |
| Post-check type-only | Maps already-checked type or declaration provenance to a Rust carrier. |
| Binding-only | Associates a local source use/write with its declaration; does not select a source operation. |
| Provider declaration production | Validates or materializes deterministic provider metadata without source-use filtering. |
| Explicit source-profile policy | Uses a member name only after ownership and exact selected declaration are proven. |
| Wrong abstraction | Would need deletion or rework before merge. |
| TSTS contract gap | Required selected evidence is absent from the public request/fact contract. |

## Checker Query Inventory

The current product tree contains 21 checker call sites. The scanner maintains an exact file/function/method allowlist for all 21. Any added, removed, or moved checker call fails the scanner until this inventory and its justification are updated.

| File | Function | Checker methods | Classification | Reason and action |
| --- | --- | --- | --- | --- |
| `src/source/rust-target-semantics/index.ts` | `stringParamOnlyBorrows` | `getSymbolAtLocation` | Binding-only | Binds the declared parameter symbol before structural `usesOf` analysis. Borrow decisions come from finalized operation facts on each use. Retain. |
| `src/source/rust-target-semantics/index.ts` | `resolveIdentifierCarrier` | `getSymbolAtLocation`, `getSymbolValueDeclaration`, `getPrimarySymbolDeclaration` | Binding-only | Resolves only parameter and variable declarations carrying finalized carriers. It is mechanically barred from becoming provider-import identity recovery. Retain. |
| `src/source/rust-target-semantics/index.ts` | `recordBindingWrite` | `getResolvedSymbolOrNil`, `getSymbolValueDeclaration`, `getPrimarySymbolDeclaration`, `getSymbolDeclarations` | Binding-only | Associates a structural write with its local declaration for mutability facts. It does not choose a member/signature. Retain. |
| `src/source/rust-target-semantics/target-type-resolution.ts` | `resolveRustTargetTypeRef` | `getTypeAtLocation` | Post-check type-only | Last-stage mapping of a checked expression type after finalized carrier, operation result, selected-call result, source primitive, authored syntax, and declaration provenance are considered. No catch or operation selection. Retain. |
| `src/source/rust-target-semantics/target-type-resolution.ts` | `resolveRustTargetTypeSyntax` | `getSymbolAtLocation`, `getPrimarySymbolDeclaration` | Post-check type-only | Binds the exact symbol authored in a type-reference node, then reads provider/source-profile/project facts from that symbol/declaration. Retain. |
| `src/source/rust-target-semantics/target-type-resolution.ts` | `resolveReferencedDeclarationType` | `getSymbolAtLocation`, `getSymbolDeclarations` | Binding/type-only | Resolves a plain value reference to a declaration carrier, authored type, or already-finalized initializer return. It does not select a provider value operation. Retain. |
| `src/source/rust-target-semantics/target-type-resolution.ts` | `resolveRustTargetType` | `getTypeAliasSymbol`, `getTypeSymbol` | Post-check type-only | Obtains provenance symbols for an already-selected compiler `Type`; operation identity is not involved. Retain. |
| `src/source/rust-target-semantics/target-type-resolution.ts` | `resolveSourcePrimitive` | `getTypeAliasSymbol`, `getTypeSymbol`, `getSymbolDeclarations` | Fact provenance | Reads exact source-primitive facts. It has no primitive-name fallback. Retain. |
| `src/source/rust-target-semantics/target-type-resolution.ts` | `resolveProviderTypeIdentity` | `getSymbolDeclarations` | Selected-evidence compliant type binding | Reads provider virtual declaration facts from the selected type symbol/declarations. It does not choose a provider member. Retain. |
| `src/source/rust-target-semantics/target-type-resolution.ts` | `resolveOwnedSourceProfileTypeName` | `getSymbolDeclarations` | Explicit source-profile policy | A type name is interpreted only after its declaration path proves Rust source-profile ownership. Retain. |
| `src/source/rust-target-semantics/target-type-resolution.ts` | `resolveProjectSourceCarrier` | `getSymbolDeclarations` | Binding/type-only | Maps an exact selected project declaration through the source-type registry. Retain. |

No checker calls exist in `src/backend/**` or `src/source/provider-packages/**`.

## Type-Shape Query Inventory

All 28 `typeShape` calls are confined to `target-type-resolution.ts` and consume an already-selected `Type`:

| Function | Queries | Classification |
| --- | --- | --- |
| `resolveRustTargetType` | any/unknown/never, nullish, string, boolean, number, void, union, tuple, array, type-reference, tuple elements, type arguments | Post-check type-only carrier mapping. |
| `resolveUnion` | union members plus nullish/string/number/boolean classification | Post-check type-only closed-union mapping. |
| `instantiateTargetType` | type-reference and type arguments | Post-check generic carrier instantiation after provider identity is proven. |
| `resolveSourceProfileCarrier` | type-reference and type arguments | Explicit source-profile carrier instantiation after profile ownership is proven. |
| `resolveSparseArrayElement` | union members, undefined/void classification | Post-check JS-array element carrier mapping. |

There is no `typeShape` call in checked call/property/element/operator selection, the backend, or provider metadata production.

## Fallback-Chain Inventory

| File/function | Chain | Classification | Safety boundary |
| --- | --- | --- | --- |
| `operations-provider.ts` / `resolveRustRuntimeCarrier` | selected `sourceTypeReference` or `sourceSymbol`, then request-provided semantic `type` | Selected-evidence compliant type-only | Both subjects are supplied by TSTS. The second path maps erased structural/primitive type meaning; it does not select an operation. |
| `target-type-resolution.ts` / `resolveRustTargetTypeRef` | finalized facts, source primitive, authored syntax, referenced declaration, final checked `Type` | Post-check type-only | Every stage returns only a `TargetTypeRef`. No member/signature identity or target operation can be selected here. |
| `operations-provider.ts` / generic type-argument mapping | `explicitTypeNode` then `selectedType` | Selected-evidence compliant | Both are fields of TSTS `sourceSelectedMethodTypeArguments`; no raw `TypeArguments` reconstruction exists. |
| `index.ts` / local declaration binding | value declaration, primary declaration, declarations list | Binding-only | Used only to attach carrier/mutation facts to local declarations. It cannot select provider operations. |

No checker-query chain catches an exception or changes from one semantic query to another to see which one succeeds.

## Exception and Raw-Object Inventory

| Occurrence | Classification | Reason |
| --- | --- | --- |
| `index.ts` / `rustRegExpSubsetViolation` catch | Allowed local parser control flow | Catches only `RustRegExpViolation`, returns its deterministic violation, and rethrows every other error. It does not surround or call a checker API. |
| `provider-packages/validation.ts` record casts and `Object.keys` | Provider declaration production | Runtime validation of external metadata must inspect object keys to reject extra fields. These values are provider-model records, not compiler nodes/types. |
| `index.ts` fixed-array target metadata cast | Closed target metadata | Reads the typed `value` payload of a Rust `target-specific` carrier, not a compiler object. |

There are no product hits for raw `.TypeArguments`, raw `.Text`, bracket access to those fields, `safeGet*` checker wrappers, or swallowed `catch { return undefined/false; }` checker failures.

## Provider Identity and Name Inventory

| Path | Classification | Proof |
| --- | --- | --- |
| `provider-operation-selection.ts` | Selected-evidence compliant | Selection compares only `exportId`, `memberId`, `signatureId`, and operation kind. It never compares module/export/member spelling. |
| `selected-evidence.ts` source-profile member extraction | Explicit source-profile policy | Owner/member names are read only from the exact TSTS-selected declaration after its virtual path proves the selected Rust-owned profile. |
| `operations-provider.ts` provider call/property/indexer mapping | Selected-evidence compliant | Provider identity comes from `providerVirtualDeclarationFactKey`; names are used only for diagnostics after exact identity selection. |
| `operations-provider.ts` JS operation rows | Explicit source-profile policy | Declarative owner/member rows are selected only after exact selected source-profile declaration evidence. No receiver/source spelling recovers identity. |
| `target-type-resolution.ts` `String`/`Array`/`Map`/`Set` mapping | Explicit source-profile policy | These names are interpreted only after `resolveOwnedSourceProfileTypeName` proves profile ownership. |
| Backend project declaration/binding names | Generated project-source lowering | Names originate from exact project declarations and are not provider/library identity selection. Provider target paths come only from finalized operation metadata. |

There are no product hits for `sourceUsage`, `sourceMemberNames`, `TargetSourceUsageHints`, or `collectProjectSourceUsageHints`. Provider declarations are not filtered by raw user-source text.

## Parameter-Passing Inventory

The generic provider call path computes source argument modes from the selected operation row with `rustSourceArgumentModes`, converts them with `rustArgumentPassingMode`, and publishes those modes in the TSTS-selected target member. The backend independently requires an `argumentPassingFact` for every provider argument and rejects missing or mismatched modes.

The four literal `passingMode: "by-value"` occurrences in `operations-provider.ts` are not generic provider defaults:

| Function | Occurrence | Classification |
| --- | --- | --- |
| `mapRustSourceMarkerCall` | erased flow-marker value | Explicit synthetic source-core marker signature. |
| `mapSelectedRegExpConstruction` | pattern and flags | Explicit closed RegExp constructor signature, not a provider operation row. |
| `acceptProjectSourceCall` | project-source declaration parameters | Project-source call signature; borrow shaping remains separately fact-backed. It is outside provider-package parameter selection. |

The scanner forbids a literal by-value mode inside `acceptSelectedCall`, the generic provider operation path.

## Optional-Chain Inventory

`mapRustCheckedPropertyAccess` and `mapRustCheckedElementAccess` each inspect TSTS `request.optionalChain` first and emit `RUST_OPTIONAL_CHAIN_UNSUPPORTED`. Neither can continue into provider/source-profile selection. The backend has no optional-chain syntax branch or fallback. Rust will accept optional chains only when a finalized Rust Option operation is added to the selected-evidence contract.

## Backend Fact-Gate Inventory

| Backend lane | Required evidence | Missing-evidence behavior |
| --- | --- | --- |
| Provider calls | `rustTargetOperationFactKey` provider operation plus per-argument `argumentPassingFact` | Structured missing/unsupported diagnostic; no provider call emission. |
| Provider constructors | finalized provider constructor fact | Structured missing-target-fact diagnostic. |
| Provider properties | finalized provider property fact | Structured missing-target-fact diagnostic. |
| Provider indexers | finalized provider indexer fact | Structured missing-target-fact diagnostic. |
| Operators/conversions/literals/iteration | corresponding finalized Rust operation fact | Structured diagnostic and no expression/artifact path. |
| Direct project-source function call | TSTS `selectedTargetSignatureFact` naming an exact project declaration | This is a separate project-source lane, not provider fallback. Missing selected declaration fails closed. Source methods, static methods, and constructors use finalized Rust operation facts. |

The backend and provider metadata layers contain no checker calls and cannot recover provider identity by source spelling.

## Lifecycle Walker Inventory

| Walker | Classification | Evidence source |
| --- | --- | --- |
| Source-type registration | Provider-independent declaration indexing | TSTS AST declarations and explicit source-profile ownership. No selected operation is synthesized. |
| Carrier walk | Post-check type/fact propagation | Finalized TSTS/Rust facts plus the type-only resolver inventory above. |
| Fallibility fixpoint | Finalized-fact consumer | Walks project declarations and reads selected project declarations and finalized Rust operation facts. It does not query the checker. |
| Mutation recording | Binding-only | Structural writes plus local declaration binding; no member/signature selection. |

## Open TSTS Contract Gap: Provider Values

A plain imported provider value has no checked value-reference observation carrying selected provider identity. Example:

```ts
import { platform } from "node:process";
check(platform.length > 0);
```

TSTS supplies selected evidence for the checked property access (`length`) but not for the plain provider-backed identifier `platform`. Rust therefore cannot finalize the value operation/path without rediscovering the import through checker or spelling inference. The current local identifier resolver is deliberately limited to parameters and variables and does not act as a provider-import workaround.

Classification: **TSTS contract gap**. The target-neutral request is recorded in:

- `.analysis/tsts-issues/20260713-211259-provider-value-identifier-selected-evidence.md`

Until TSTS exposes selected value-reference evidence, this case must fail closed. No checker re-entry, import-name matching, module spelling inference, or backend path guessing is permitted.

## Mechanical Guards

`test/architecture/scanners.test.mjs` now enforces:

1. An exact checker-query file/function/method allowlist.
2. No operation-selection checker APIs, broad `safeGet*` wrappers, swallowed checker failures, raw `TypeArguments`, or raw `Text` in Rust semantic product paths.
3. No raw compiler fields or source-use hint channel anywhere in Rust source/backend product code.
4. `typeShape` confinement to closed target type resolution.
5. No checker calls in backend or provider metadata layers.
6. Provider operation selection by exact provider IDs, never names.
7. Metadata-derived provider parameter modes plus backend argument-passing fact gates.
8. Optional-chain rejection before normal member selection and no backend optional-chain fallback.
9. No provider-import recovery in the local identifier carrier resolver.
10. Finalized provider operation facts for backend constructor/property/indexer lanes.
11. No provider target recasing, raw trailing argument strings, receiver-name identity guessing, or artifact emission after diagnostics.

## Disposition

- Wrong-abstraction hits found in the audited product paths: **0**.
- Unclassified checker/type-shape/raw-object hits: **0**.
- TSTS contract gaps: **1**, provider-backed plain value selected evidence.
- Local workaround added for the TSTS gap: **none**.
