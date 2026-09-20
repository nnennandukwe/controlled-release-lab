# Participant worksheet: justify the release decision

You are examining a read-only catalog ranking change. The hosted operator controls
deployment and exposure; your job is to identify the evidence that supports each
decision. The traffic and personas are synthetic. Mark every answer **current
session** or **historical example** and include its run/attempt or file reference.
Do not enter credentials, personal customer data, or an inferred result.

For each checkpoint, record the subject (source/image/deployment/configuration/
audience/window), your observation, your decision, and any missing evidence.

| Checkpoint | Task | Your evidence-backed answer |
|---|---|---|
| 1. Baseline | Identify the serving subject and original behavior. What does readiness leave unproven? | |
| 2. Build | Explain what the signed image provenance proves. Why must E with F's bundle be rejected? What still needs runtime measurement? | |
| 3. Deploy versus expose | F has reached live. Identify evidence that live still serves original behavior, then identify what authorizes the first exposure. | |
| 4. Detect and contain | Find the latency/coverage/error results. Decide whether 25% is allowed. Show both the refused action and same-F disable recovery. | |
| 5. Recover the application | Compare feature disablement with native rollback. Why is an acknowledgment insufficient, and what proves reconciliation? | |
| 6. Complete and hand over | Trace G's internal/5/25/100 predecessor chain. Separate completion from monitoring, name the owner, and list what prevents flag retirement. | |

For checkpoint 4, do not assume exactly 5% of a finite population receives treatment.
For checkpoint 5, preserve the original uncertain record rather than calling it a
success after reconciliation. For checkpoint 6, a historical completed release does
not establish current health or authorize another release.

## Transfer the reasoning

A different service writes records while a flag is on. Would disabling that flag
undo writes already performed? State the additional recovery design you would need.

A signed proof is healthy but belongs to yesterday's deployment/configuration.
What must happen before it can support today's action?

Record one instruction that was unclear and the exact step where you needed help.
A blank answer or unresolved question is useful feedback; do not replace it with
a plausible result.
