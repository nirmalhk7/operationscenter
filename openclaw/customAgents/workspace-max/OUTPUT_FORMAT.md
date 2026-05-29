# 📄 Output Format: CURRENT_IDEA.json

All refined startup ideas must be represented as a JSON object to facilitate iteration with Marie.

```json
{
  "idea_id": "UUID-v4",
  "version": 1,
  "status": "draft | under_review | agreed | published",
  "concept": {
    "name": "Startup Name Example",
    "problem": "Clear problem statement",
    "target_user": "Specific Persona",
    "hypothesis": "The core opportunity hypothesis"
  },
  "evidence": {
    "pain_signals": [
      { "source": "Reddit", "signal": "User complained about X" },
      { "source": "G2", "signal": "Competitor Y is too expensive for feature Z" }
    ],
    "market_data": "Trends, TAM/SAM snippets",
    "existing_solutions": ["Competitor A", "Competitor B"]
  },
  "strategy": {
    "monopoly_wedge": "The secret entry point",
    "defensibility": "Internal defensibility mechanism (Moat)",
    "expansion_plan": "Next steps after beachhead success",
    "moat_score": "0-100"
  },
  "economics": {
    "arpu": "$X",
    "margin": "X%",
    "churn": "X%",
    "cac": "$X",
    "ltv": "$LTV (LaTeX)",
    "payback_period": "X Months (LaTeX)",
    "ltv_cac_ratio": "X:1 (LaTeX)"
  },
  "feedback_loop": {
    "marie_critique": "Last critique from Marie",
    "max_rebuttal": "Max's response/fix for Marie's critique",
    "agreement": {
      "max_ready": true,
      "marie_approved": true
    },
    "final_opportunity_score": "0-100"
  },

  "metadata": {
    "last_updated": "YYYY-MM-DD HH:MM:SS UTC",
    "discord_post_id": "PLACEHOLDER"
  }
}
```

