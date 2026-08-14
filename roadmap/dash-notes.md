OK. Consider the roadmap/dash-integration-plan.md. I want to insert a new Phase 2.1. Here's the rub. The current workflow to create a plan that is suitable for `/implement` to work on goes like this:
- I develop an idea interactively in a session. This is good.
- We often produce a brief from this discussion. This is fine too.
- I run `/devise` against either the discussion or the brief. Still OK.
- I run `/vet` against the devised plan, and the result of this vetting is *basically always* me saying: "do the fixups!". This sucks. We need to figure out a way to ball up this vetting and fixup roung with `/devise`. This should be *one step* to produced a divised, vetted, and fixed up plan. We also should *always* use Opus (for now) when vetting and fixups, regardless of what model was used to devise the plan

Make me a proposal for how we can achieve this. Ideally, `/vet` goes away.



| Skill | Rides | Rule check |
| --- | --- | --- |
| plan-devise | tugutil plan | ✓ |
| plan-review | tugutil plan | ✓ (fixes the suffix inversion) |
| dash-implement | tugutil dash | ✓ (unchanged) |
| dash-on | tugutil dash | ✓ (unchanged) |
| dash-audit | tugutil dash | ✓ (unchanged) |
| dash-join | tugutil dash | ✓ (unchanged) |
| draft | tugutil draft | ✓ (unchanged — the namespace is the name) |


