import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const numericObservations = `
    assert_eq!(callback.call((0.0,)).unwrap(), 1.0);
    assert_eq!(callback.call((1.0,)).unwrap(), 2.0);
    assert_eq!(callback.call((8.0,)).unwrap(), 2.0);
`;

const numericRunSource = `
export function run(): boolean {
  const callback = escaped();
  const alias = callback;
  const other = escaped();
  return callback === alias && callback !== other && callback(0) === 1 && callback(1) === 2 && callback(8) === 2;
}
export function main(): void { if (!run()) throw new Error("recursive callback live binding and identity"); }
`;

const frameRootReference = `
use std::rc::{Rc, Weak};

thread_local! {
    static FRAME_DROPS: Cell<usize> = const { Cell::new(0) };
}

trait ClosedFrame: Sized {
    type Entry: Copy + Eq;
    type Output;

    fn weak_owner(&self) -> &Weak<Self>;
    fn invoke(&self, entry: Self::Entry, count: f64) -> Self::Output;

    fn export(&self, entry: Self::Entry) -> FrameRoot<Self> {
        FrameRoot {
            owner: self.weak_owner().upgrade().expect("an exporting frame has a live root"),
            entry,
        }
    }
}

struct FrameRoot<Frame: ClosedFrame> {
    owner: Rc<Frame>,
    entry: Frame::Entry,
}

impl<Frame: ClosedFrame> Clone for FrameRoot<Frame> {
    fn clone(&self) -> Self {
        Self { owner: Rc::clone(&self.owner), entry: self.entry }
    }
}

impl<Frame: ClosedFrame> PartialEq for FrameRoot<Frame> {
    fn eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.owner, &other.owner) && self.entry == other.entry
    }
}

impl<Frame: ClosedFrame> FrameRoot<Frame> {
    fn call(&self, count: f64) -> Frame::Output {
        self.owner.invoke(self.entry, count)
    }

    fn other_entry(&self, entry: Frame::Entry) -> Self {
        self.owner.export(entry)
    }
}
`;

const selectedFrameReference = `
#[derive(Clone, Copy, PartialEq, Eq)]
enum SelectedEntry { Original, Replacement }

struct SelectedFrame {
    owner: Weak<Self>,
    selected: Cell<SelectedEntry>,
}

impl ClosedFrame for SelectedFrame {
    type Entry = SelectedEntry;
    type Output = f64;

    fn weak_owner(&self) -> &Weak<Self> { &self.owner }

    fn invoke(&self, entry: SelectedEntry, count: f64) -> f64 {
        if count == 0.0 {
            match entry { SelectedEntry::Original => 1.0, SelectedEntry::Replacement => 2.0 }
        } else {
            self.invoke(self.selected.get(), count - 1.0)
        }
    }
}

impl Drop for SelectedFrame {
    fn drop(&mut self) { FRAME_DROPS.set(FRAME_DROPS.get() + 1); }
}

fn reference_escaped() -> FrameRoot<SelectedFrame> {
    let owner = Rc::new_cyclic(|owner| SelectedFrame {
        owner: owner.clone(), selected: Cell::new(SelectedEntry::Original),
    });
    let before = owner.export(SelectedEntry::Original);
    owner.selected.set(SelectedEntry::Replacement);
    before
}
`;

const parityFrameReference = `
#[derive(Clone, Copy, PartialEq, Eq)]
enum ParityEntry { Even, Odd }

struct ParityFrame { owner: Weak<Self> }

impl ClosedFrame for ParityFrame {
    type Entry = ParityEntry;
    type Output = bool;

    fn weak_owner(&self) -> &Weak<Self> { &self.owner }

    fn invoke(&self, entry: ParityEntry, count: f64) -> bool {
        if count == 0.0 {
            entry == ParityEntry::Even
        } else {
            let next = match entry { ParityEntry::Even => ParityEntry::Odd, ParityEntry::Odd => ParityEntry::Even };
            self.invoke(next, count - 1.0)
        }
    }
}

impl Drop for ParityFrame {
    fn drop(&mut self) { FRAME_DROPS.set(FRAME_DROPS.get() + 1); }
}

fn reference_escaped() -> FrameRoot<ParityFrame> {
    let owner = Rc::new_cyclic(|owner| ParityFrame { owner: owner.clone() });
    owner.export(ParityEntry::Even)
}
`;

const cases = [
  {
    name: "mutable-lexical",
    source: `
export function escaped(): (count: number) => number {
  let selected = (count: number): number => count === 0 ? 1 : selected(count - 1);
  const before = selected;
  selected = (count: number): number => count === 0 ? 2 : selected(count - 1);
  return before;
}
${numericRunSource}
`,
    observations: numericObservations,
    reference: selectedFrameReference,
    referenceObservations: `
    assert_eq!(callback.call(0.0), 1.0);
    assert_eq!(callback.call(1.0), 2.0);
    assert_eq!(callback.call(8.0), 2.0);
`,
    referenceOther: "SelectedEntry::Replacement",
    referenceOtherObservation: "assert_eq!(other.call(0.0), 2.0);",
  },
  {
    name: "mutable-field",
    source: `
class Value {
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void {
    this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1);
  }
}
export function escaped(): (count: number) => number {
  const value = new Value();
  const before = value.recurse;
  value.rebind();
  return before;
}
${numericRunSource}
`,
    observations: numericObservations,
    reference: selectedFrameReference,
    referenceObservations: `
    assert_eq!(callback.call(0.0), 1.0);
    assert_eq!(callback.call(1.0), 2.0);
    assert_eq!(callback.call(8.0), 2.0);
`,
    referenceOther: "SelectedEntry::Replacement",
    referenceOtherObservation: "assert_eq!(other.call(0.0), 2.0);",
  },
  {
    name: "mutual-fields",
    source: `
class Parity {
  readonly even = (count: number): boolean => count === 0 ? true : this.odd(count - 1);
  readonly odd = (count: number): boolean => count === 0 ? false : this.even(count - 1);
}
export function escaped(): (count: number) => boolean { return new Parity().even; }
export function run(): boolean {
  const callback = escaped();
  const alias = callback;
  const other = escaped();
  return callback === alias && callback !== other && callback(0) && !callback(1) && callback(8) && !callback(7);
}
export function main(): void { if (!run()) throw new Error("mutual callback escaped lifetime and identity"); }
`,
    observations: `
    assert!(callback.call((0.0,)).unwrap());
    assert!(!callback.call((1.0,)).unwrap());
    assert!(callback.call((8.0,)).unwrap());
    assert!(!callback.call((7.0,)).unwrap());
`,
    reference: parityFrameReference,
    referenceObservations: `
    assert!(callback.call(0.0));
    assert!(!callback.call(1.0));
    assert!(callback.call(8.0));
    assert!(!callback.call(7.0));
`,
    referenceOther: "ParityEntry::Odd",
    referenceOtherObservation: "assert!(!other.call(0.0)); assert!(other.call(1.0));",
  },
];

function nativeProof(caseInput) {
  return `
#[cfg(test)]
mod recursive_callback_lifetime_cost {
    use super::*;
    ${nativeOwnershipCostSupport}
    ${frameRootReference}
    ${caseInput.reference}

    #[test]
    fn generated_escaped_entry_keeps_identity_and_current_binding_without_warmed_allocation() {
        let callback = escaped();
        let alias = callback.clone();
        let independent = escaped();
        assert!(callback == alias);
        assert!(callback != independent);
        ${caseInput.observations}
        let (_, cost) = measure(|| {
            for _ in 0..32 {
                ${caseInput.observations}
                assert!(callback == alias);
                assert!(callback != independent);
            }
        });
        assert_eq!(cost, Cost::default(), "warmed calls and identity comparisons allocate nothing");
    }

    #[test]
    fn generated_last_external_entry_releases_every_native_allocation() {
        for _ in 0..32 {
            let (callback, created) = measure(escaped);
            assert!(created.allocations > 0, "the escaped owner is measured");
            assert_eq!(created.reallocations, 0, "fixed callback storage does not resize");
            let (alias, alias_cost) = measure(|| callback.clone());
            assert_eq!(alias_cost, Cost::default(), "aliasing an entry allocates nothing");
            assert!(callback == alias);
            ${caseInput.observations}
            let (_, first_drop) = measure(|| drop(alias));
            assert_eq!(first_drop, Cost::default(), "a retained external entry keeps its frame alive");
            ${caseInput.observations}
            let (_, final_drop) = measure(|| drop(callback));
            assert_eq!(final_drop.allocations, 0, "dropping the final root does not allocate");
            assert_eq!(final_drop.reallocations, 0);
            assert_eq!(created.allocations, created.deallocations + final_drop.deallocations,
                "every allocation is released, including recursive backing storage");
            assert_eq!(created.allocated_bytes, created.deallocated_bytes + final_drop.deallocated_bytes,
                "every byte of recursive backing storage is released");
        }
    }

    #[test]
    fn native_closed_frame_has_one_owner_no_warmed_cost_and_balanced_final_drop() {
        FRAME_DROPS.set(0);
        for iteration in 0..32 {
            let (callback, created) = measure(reference_escaped);
            assert_eq!(created.allocations, 1);
            assert_eq!(created.deallocations, 0);
            assert_eq!(created.reallocations, 0);
            assert_eq!(FRAME_DROPS.get(), iteration);
            ${caseInput.referenceObservations}
            let (alias, alias_cost) = measure(|| callback.clone());
            assert_eq!(alias_cost, Cost::default());
            assert!(callback == alias);
            let (other, exported_cost) = measure(|| callback.other_entry(${caseInput.referenceOther}));
            assert_eq!(exported_cost, Cost::default(), "exporting another entry only retains the live frame");
            assert!(callback != other, "one frame preserves separate callable identities");
            ${caseInput.referenceOtherObservation}
            let (_, warmed) = measure(|| {
                for _ in 0..32 {
                    ${caseInput.referenceObservations}
                    ${caseInput.referenceOtherObservation}
                }
            });
            assert_eq!(warmed, Cost::default());
            let (_, first_drop) = measure(|| { drop(alias); drop(other); });
            assert_eq!(first_drop, Cost::default());
            assert_eq!(FRAME_DROPS.get(), iteration);
            ${caseInput.referenceObservations}
            let (_, final_drop) = measure(|| drop(callback));
            assert_eq!(FRAME_DROPS.get(), iteration + 1);
            assert_eq!(final_drop.allocations, 0);
            assert_eq!(final_drop.reallocations, 0);
            assert_eq!(final_drop.deallocations, created.allocations);
            assert_eq!(final_drop.deallocated_bytes, created.allocated_bytes);
        }
    }

    #[test]
    fn generated_construction_matches_the_native_closed_frame_allocation_budget() {
        let (reference, reference_cost) = measure(reference_escaped);
        let (callback, generated_cost) = measure(escaped);
        ${caseInput.observations}
        ${caseInput.referenceObservations.replaceAll("callback.call", "reference.call")}
        assert_eq!(generated_cost.allocations, reference_cost.allocations,
            "closed recursive callbacks need only the native frame allocation");
        assert_eq!(generated_cost.reallocations, reference_cost.reallocations);
        assert_eq!(generated_cost.deallocations, reference_cost.deallocations,
            "construction does not manufacture temporary callback owners");
    }
}
`;
}

for (const caseInput of cases) {
  for (const surfaces of [[], ["js"]]) {
    const profile = surfaces[0] ?? "native";
    test(`${caseInput.name} recursive callbacks retain escaped observations and release native owners in ${profile}`,
      { timeout: 300_000 }, () => {
        const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
          files: { "index.ts": caseInput.source } });
        assert.equal(result.diagnostics.length, 0,
          result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
        const emitted = artifactText(result, "src/index.rs");
        assert.equal(typeof emitted === "string", true, "the public compiler produces actual native source");
        const directory = writeGeneratedProject(`recursive-callback-${caseInput.name}-${profile}`, result.artifacts);
        runCargo(directory, ["generate-lockfile", "--offline"]);
        runCargo(directory, ["fmt", "--all", "--check"]);
        appendFileSync(join(directory, "src/index.rs"), nativeProof(caseInput));
        runCargo(directory, ["fmt", "--all"]);
        runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
        runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
        runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
        runCargo(directory, ["run", "--release", "--locked", "--offline"]);
      });
  }
}
