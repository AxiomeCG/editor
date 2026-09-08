# Pascal Craftsman Onboarding — Wall Split Contribution

> Local learning document. Keep it out of commits and pull requests.
>
> Learner-facing. The adaptive tutor has a separate mentor-only solution key in
> `LOCAL_WALL_SPLIT_SOLUTION.md`. Do not open that file yourself; let the tutor
> use it to pace hints and review your reasoning.

## Purpose

This is both:

1. an onboarding path through Pascal Editor's architecture; and
2. a contribution path toward an explicit **Split Wall** interaction proven in
   Kaizen.

The objective is not to transplant Kaizen code. The objective is to understand
Pascal's current modules, express the behavior through their interfaces, and
make a small contribution that a Pascal maintainer can review confidently.

The first contribution target is **Split Wall**. Pascal current `main` already
contains the substantive Push/Offset Wall behavior, so Push is a study subject
and a source of patterns—not a second implementation target.

## Starting state

- Public upstream: `pascalorg/editor`
- Your fork: `AxiomeCG/editor`
- Local workspace: `pascal/`
- `origin` should point to your fork.
- `upstream` should point to `pascalorg/editor`.
- Dependencies are installed with Bun.
- Kaizen is a downstream behavioral reference built against older Pascal
  packages (`0.9.2` / nodes `0.1.1`). Its package patches are not suitable as
  upstream diffs.
- Pascal's custom block editor already uses the term **Loop Cut**. The
  architectural wall operation must be named **Split Wall** to avoid two
  meanings for one term.

## The craft compact

The adaptive tutor should enforce these rules:

1. **You predict first.** Before opening the next implementation file, state
   what you expect its responsibility and interface to be.
2. **You type consequential code.** The tutor may explain, point to a symbol,
   or offer a small local hint. It should not generate the complete feature in
   your working tree.
3. **One concept per step.** Complete the current observation, test, or code
   slice before seeing the next one.
4. **Behavior before mechanism.** Write the observable contract and a red test
   before choosing React structure.
5. **Trace interfaces, not filenames alone.** For each module, identify what a
   caller must know, what complexity remains hidden, and where the seam lives.
6. **Preview and commit are different data paths.** Explain where transient
   state lives and why committed state belongs in `useScene`.
7. **2D and 3D are two presentations of one edit.** A feature is incomplete if
   applicable behavior exists in only one view.
8. **One writer.** Parallel Zed threads may investigate independently. Only one
   thread or human edits a given worktree. Use a separate Git worktree if two
   writers must proceed independently.
9. **Evidence ends every lesson.** A diagram, explanation, focused test, running
   behavior, or reviewed diff must establish completion.
10. **Local notes stay local.** Do not stage either `LOCAL_*.md` file.

## Using the adaptive tutor in Zed

Open the `pascal/` folder in Zed. Zed loads the repository's `AGENTS.md`
automatically. Start a fresh Agent thread for each lesson so context remains
focused.

In the first message of a lesson, attach context with `@` rather than asking the
agent to scan the repository broadly. Attach:

- `@LOCAL_CRAFTSMAN_ONBOARDING.md`
- `@LOCAL_WALL_SPLIT_SOLUTION.md`
- only the architecture page and source files named by the lesson

Use this opening prompt:

```text
Act as my adaptive Pascal craftsman tutor.

Read the learner plan and the mentor-only solution key. Do not quote or reveal
future solution steps. Do not edit files unless the current lesson explicitly
reaches a coding slice and I ask you to review or make a tiny mechanical edit.

For this lesson:
1. ask me for a prediction before showing an answer;
2. teach one concept at a time;
3. use questions and local hints before code;
4. require the lesson's completion evidence;
5. stop at the next gate.

Current lesson: <lesson name>
My current hypothesis: <your explanation>
```

Useful Zed context actions:

- Type `@` to attach a file, directory, symbol, previous thread, diagnostics,
  or the current branch diff.
- Select a small code region and run **Agent: Add Selection to Thread** rather
  than attaching a whole large file.
- Use a new thread when moving from investigation to implementation.
- Use `@diff` for a review thread after each coding slice.
- Invoke `/review-architecture` before the final PR review.
- Invoke `/open-pr` only after you have authored, understood, tested, committed,
  and pushed the branch.

## The architecture vocabulary

Use these words consistently while learning:

- **Module** — something with an interface and implementation.
- **Interface** — everything a caller must know, including invariants, error
  modes, ordering, and performance expectations.
- **Seam** — the location where the interface lives and behavior can vary.
- **Depth** — how much behavior the interface hides for its callers.
- **Locality** — whether one change fixes behavior in one place rather than in
  every caller.

For every file you study, answer:

1. Which module is this?
2. What is its interface?
3. Which callers cross its seam?
4. Which behavior is deliberately hidden inside it?
5. How is that interface tested?

---

# Lesson path

## Lesson 0 — Establish a trusted baseline

### Context

Attach:

- `@AGENTS.md`
- `@CONTRIBUTING.md`
- `@SETUP.md`
- `@package.json`

### Work

1. Explain the package boundaries in your own words.
2. Verify `origin` and `upstream` without changing them.
3. Start Pascal with `bun dev`.
4. Open `http://localhost:3002`.
5. Create or open a simple level with four connected walls.
6. Select one wall and exercise the existing side-move arrows in both 2D and
   3D.
7. Confirm one Undo restores the move.

### Targeted tutor call

```text
Using only the attached repository guidance, quiz me on which package owns:
scene topology, committed state, 3D rendering, editor interaction state, and a
registry-owned wall tool. Correct only one misconception at a time.
```

### Completion evidence

You can explain why a wall movement is not a rendered-mesh mutation and can
identify one behavior that is shared by the 2D and 3D wall move paths.

---

## Lesson 1 — Trace the existing Push/Offset Wall behavior

Push is already present upstream. Treat it as an apprenticeship example.

### Context

Attach these files one at a time, predicting the next responsibility before
opening it:

- `@wiki/architecture/tools.md`
- `@wiki/architecture/interaction-scope.md`
- `@packages/nodes/src/wall/definition.ts`
- `@packages/editor/src/components/editor/wall-move-side-handles.tsx`
- `@packages/nodes/src/wall/move-tool.tsx`
- `@packages/nodes/src/wall/floorplan-move.ts`
- `@packages/core/src/systems/wall/wall-move.ts`

### Questions to answer

1. Which event activates a wall move?
2. Where is the wall-normal axis calculated?
3. Which module decides how linked endpoints behave?
4. Where does drag-time preview data live?
5. Which write creates the committed scene state?
6. Why do off-axis neighbors sometimes require bridge walls?
7. How do 2D and 3D reach the same topology behavior through different input
   mechanisms?
8. What makes the complete operation one undo step?

### Targeted tutor call

```text
Do not summarize these files. Ask me to trace one value: the pointer movement
that becomes a wall-normal delta, then linked-wall updates, then one committed
history entry. After each answer, point me to only the next symbol.
```

### Completion evidence

Draw this call flow from memory, with real symbol names:

```text
activation → interaction scope → pointer proposal → pure junction plan
→ transient preview → atomic commit → selection/history cleanup
```

Explain why adding another `pushPullWall` implementation would reduce locality.

---

## Lesson 2 — Extract the Kaizen behavior contract

Kaizen is proof that the interaction is useful. It is not the upstream design.

### Context

Open the separate `kaizen/` project and inspect:

- `src/lib/room-model.ts` — `planWallSplit` and `planWallPushPull`
- `src/lib/room-model.test.ts`
- `src/lib/pascal/architecture.ts` — `splitWall` and `pushPullWall`
- `src/lib/pascal/viewport-interaction.tsx` — split preview and commit
- `src/lib/pascal/viewport-interaction-split.test.ts`

### Work

Without copying code, write a behavioral table:

| Situation | Preview | Commit | History | Selection |
|---|---|---|---|---|
| Valid interior split | | | | |
| Split near endpoint | | | | |
| Split through opening | | | | |
| Split on short wall | | | | |
| Cancel | | | | |

Add rows for anything you discover manually.

Record separately:

- what users feel;
- what Kaizen does only because it embeds Pascal `0.9.2`;
- what current Pascal already solves more deeply.

### Targeted tutor call

```text
Review my behavior table against the Kaizen files. Report only missing or
ambiguous observable behavior. Do not propose Pascal implementation files yet.
```

### Completion evidence

The table is sufficient for another person to reproduce the behavior without
seeing Kaizen's implementation.

---

## Lesson 3 — Understand Pascal's existing split topology module

### Context

Attach:

- `@packages/core/src/systems/wall/wall-topology.ts`
- the `planWallSplitAtPoint` tests from
  `@packages/core/src/systems/wall/wall-topology.test.ts`
- `@packages/editor/src/components/tools/wall/wall-drafting.ts`

### Questions to answer

1. Why does the planner return changes instead of mutating `useScene`?
2. How are doors, windows, and wall-mounted items reassigned?
3. What happens if an attachment crosses the split?
4. How are curved walls divided?
5. Why can a successful result contain an empty change set?
6. Which current caller applies this planner, and for what interaction?
7. What extra information would an explicit Split Wall preview need?

### Targeted tutor call

```text
Ask me to explain planWallSplitAtPoint as a deep module. Challenge me on its
input frame, output invariants, attachment behavior, curved walls, and no-op
case. Reveal no proposed replacement interface until I identify the current
interface's strengths and friction.
```

### Completion evidence

You can construct a valid `WallTopologyChanges` result by hand and explain every
create, update, and delete required for a wall with one opening on each side of
the cut.

---

## Lesson 4 — Write the contribution contract before code

### Work

Prepare a focused GitHub feature request titled:

```text
Wall: add an explicit split-at-point editing interaction
```

The issue should state:

- the user problem;
- the existing Kaizen proof of behavior;
- the fact that current Pascal already owns the topology planner;
- the proposed 2D/3D felt behavior;
- invalid/cancel/undo behavior;
- the intended parametric-node write path;
- the open UX question: selected-wall contextual action versus a global tool.

Attach a short screen recording from Kaizen. Do not attach patch-package diffs.

### Targeted tutor call

```text
Review this feature request as a Pascal maintainer. Check that it describes one
capability, has observable acceptance criteria, acknowledges current main, and
leaves genuine UX ownership questions open. Do not turn it into an umbrella
roadmap.
```

### Gate

A local spike may continue for learning, but do not present a PR as ready until
a maintainer has had the opportunity to correct the interaction seam or reject
the feature priority.

### Completion evidence

The issue can be understood without knowing Kaizen internals and can be answered
with a clear yes, no, or requested contract change.

---

## Lesson 5 — Strengthen the pure topology contract test-first

Create a feature branch only now:

```bash
git switch -c feat/wall-split-tool
```

### First red cases

Write focused core tests for the agreed interface. Cover observable topology
contracts rather than source structure:

- straight wall split into two segments;
- curved wall split preserving the curve;
- opening before the split reparented without offset change;
- opening after the split reparented with rebased offset;
- opening straddling the split rejected;
- endpoint/near-endpoint split rejected or represented as a no-op by contract;
- input scene remains unchanged;
- terrain/support metadata remains coherent.

Run only the package test while iterating:

```bash
bun --cwd packages/core run test
```

### Targeted tutor call

```text
Review only my red tests. For each test, ask what user-visible or topology
invariant it protects. Reject tests that merely mirror implementation details.
Do not implement the planner for me.
```

### Completion evidence

At least one meaningful new contract test is red for the intended reason, and
you can explain the smallest core interface change that will make it green.

---

## Lesson 6 — Implement the 3D interaction slice

### Context

Attach only the approved core split interface plus:

- `@wiki/architecture/events.md`
- `@wiki/architecture/interaction-scope.md`
- `@packages/nodes/src/wall/definition.ts`
- one small existing wall-event tool as a pattern
- `@packages/editor/src/components/tools/tool-manager.tsx`

### Slice order

1. Activation enters one explicit interaction scope.
2. Hover resolves a pure proposed split with no scene mutation.
3. Preview renders from the proposal.
4. Invalid proposals are visible and cannot commit.
5. Click applies one atomic change set.
6. Escape/unmount clears preview and returns the scope to idle.
7. The deleted original wall cannot remain selected.

Do not add 2D code in this lesson. The goal is to understand one presentation
before porting the felt behavior.

### Targeted tutor call

```text
Inspect my 3D slice through the lifecycle: begin, hover proposal, preview,
commit, cancel, cleanup. Ask me where each piece of state lives and why. Point
out the first violated invariant only; let me repair it before continuing.
```

### Completion evidence

A manual 3D scenario demonstrates valid preview, invalid preview, commit,
cancel, and one-step undo. The scene is not mutated during pointer movement.

---

## Lesson 7 — Port felt behavior to 2D

### Context

Attach:

- `@wiki/architecture/tools.md`, specifically the parity section
- the finished 3D slice
- `@packages/editor/src/components/editor-2d/floorplan-registry-move-overlay.tsx`
  as a coordinate/lifecycle pattern
- the floor-plan action-menu and layer files selected during design

### Work

Implement a 2D interaction body using plan-space pointer coordinates. It may
use a different mechanism, but must match 3D on:

- target wall;
- projected cut point;
- validity;
- visual state;
- commit result;
- cancel behavior;
- one-step undo;
- cleanup.

### Targeted tutor call

```text
Compare the 2D and 3D interactions by felt behavior, not component shape. Build
a parity matrix and ask me to repair one mismatch at a time. Pay special
attention to pointer coordinate frames and duplicate commit ownership.
```

### Completion evidence

The same scenario sequence produces equivalent topology and history in 2D,
3D, and split view.

---

## Lesson 8 — Harden integration behavior

### Checks

- Switching view while the interaction is active.
- Escape before any valid hover.
- Escape after a valid preview.
- Clicking the exact endpoint.
- Clicking through a door/window span.
- Very short wall.
- Curved wall.
- Rotated or translated building.
- Elevated level and terrain-supported wall.
- Split view, ensuring one pointer gesture commits once.
- Selection after the original wall ID is deleted.
- Undo and redo.

### Targeted tutor call

```text
Use the mentor solution only as a review key. Give me one adversarial manual
scenario at a time. Ask for my prediction, then let me run it. Do not batch all
failures or edit the fix.
```

### Completion evidence

Each supported case has observed behavior. Unsupported cases are explicit in
the issue/PR rather than silently failing.

---

## Lesson 9 — Contribution-quality review

### Commands

Run focused checks first, then repository checks once:

```bash
bun --cwd packages/core run test
bun --cwd packages/nodes run test
bun --cwd packages/editor run test
bun check
bun run test
```

Use Zed with `@diff` and invoke:

```text
/review-architecture
```

Review the PR as a maintainer:

- one capability;
- no copied Kaizen patch artifacts;
- no duplicate Push implementation;
- pure topology logic in core;
- preview state outside `useScene`;
- committed state through one atomic change set;
- 2D/3D parity;
- clean cancellation and selection;
- meaningful tests;
- a short screen recording;
- exact reproduction/testing steps.

### Final learner explanation

Before opening a PR, explain aloud:

1. the user problem;
2. the chosen seam;
3. why the module interface is deep enough;
4. preview versus commit ownership;
5. 2D/3D parity;
6. topology edge cases;
7. verification evidence.

If any answer depends on “the AI wrote it,” return to that lesson.

---

# Learning ledger

Fill this after each session. Keep entries short and concrete.

| Date | Lesson | Concept learned | Prediction that was wrong | Evidence produced | Next gate |
|---|---|---|---|---|---|
| | | | | | |

# Contribution boundary

The following remain separate potential contributions and must not enter the
Split Wall PR:

- cutaway rendering;
- wall selection/raycast patches;
- cursor-sphere raycast behavior;
- opening move-cross restoration;
- site flag asset loading;
- camera-controls patches;
- Push/Offset Wall reimplementation.

Each requires reproduction against current Pascal `main`, its own contract, and
its own focused issue or pull request.
