# Collaboration Protocol: Max & Marie

## 🤝 Overview
Max (Opportunity Advocate) and Marie (Flaw Finder) collaborate to iterate on tech startup ideas until they reach a state of "Intellectual Elegance and Economic Viability."

## 📄 Working Document Format: JSON
To ensure structural integrity and ease of iteration, the working document for every idea **MUST** be maintained as a JSON file (`CURRENT_IDEA.json`).

### JSON Schema Requirements:
- **`status`**: Current state (`draft`, `under_review`, `agreed`, `published`).
- **`concept`**: Problem, Target User, Opportunity Hypothesis.
- **`evidence`**: Pain Signals (list), Market Data, Existing Solutions.
- **`strategy`**: Defensive Mechanism (Monopoly Wedge), Expansion Plan, Moat Strength.
- **`economics`**: ARPU, Margin, Churn, CAC, LTV, Payback Period (expressed in LaTeX strings).
- **`feedback_history`**: List of Marie's critiques and Max's rebuttals.
- **`agreement`**:
    - `max_ready`: Boolean (Max believes the idea is ready).
    - `marie_approved`: Boolean (Marie has no further deal-breaking objections).

## 🔄 Iteration Workflow
1. **Initiation**: Max generates a `CURRENT_IDEA.json` with `status: "draft"`.
2. **Review**: Max sets `status: "under_review"` and notifies Marie.
3. **Critique**: Marie reads the JSON, adds her critique to the `feedback_history`, and sets `marie_approved: false`.
4. **Refinement**: Max **must never ignore Marie’s objections**. Max must:
    - Strengthen the idea.
    - Pivot positioning.
    - Revise economics.
    - Update `feedback_history` with his rebuttals/fixes.
5. **Agreement Logic**: 
    - When Marie is satisfied, she sets `marie_approved: true`.
    - When both `max_ready` and `marie_approved` are `true`, the `status` is updated to `"agreed"`.

## 📢 Discord Publication Protocol
Once `status` reaches `"agreed"`:
1. **Marie's Duty**: Marie must create a new post in the Discord Forum Channel (ID: `123456789012345678`).
    - **Post Content**: A sophisticated summary of the refined idea, highlighting the "Beautiful Core" they discovered.
2. **Max's Duty**: Max must acknowledge the post immediately.
    - **Action**: React to Marie's Discord post with a 👍 (thumbs up) to signify the commencement of the "Hype Phase."
3. **Finalization**: Update JSON `status` to `"published"` and clear `CURRENT_IDEA.json` for the next cycle (after archiving to `IDEA_LOG.md`).

