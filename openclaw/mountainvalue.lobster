{
  "name": "mountainvalue-daily-equity-research",
  "steps": [
    {
      "id": "seed_configured_universe",
      "command": "equity-research seed-configured-universe"
    },
    {
      "id": "discover_value_candidates",
      "command": "equity-research discover-value-candidates",
      "stdin": "$seed_configured_universe.stdout"
    },
    {
      "id": "discover_technical_candidates",
      "command": "equity-research discover-technical-candidates",
      "stdin": "$discover_value_candidates.stdout"
    },
    {
      "id": "merge_candidates",
      "command": "equity-research merge-candidates",
      "stdin": "$discover_technical_candidates.stdout"
    },
    {
      "id": "enrich_primary_filings",
      "command": "equity-research enrich-primary-filings",
      "stdin": "$merge_candidates.stdout"
    },
    {
      "id": "score_earnings_yield",
      "command": "equity-research score-earnings-yield",
      "stdin": "$enrich_primary_filings.stdout"
    },
    {
      "id": "score_balance_sheet_safety",
      "command": "equity-research score-balance-sheet-safety",
      "stdin": "$score_earnings_yield.stdout"
    },
    {
      "id": "score_owner_earnings_quality",
      "command": "equity-research score-owner-earnings-quality",
      "stdin": "$score_balance_sheet_safety.stdout"
    },
    {
      "id": "first_pass_review",
      "command": "equity-research first-pass-review",
      "stdin": "$score_owner_earnings_quality.stdout"
    },
    {
      "id": "scan_news",
      "command": "equity-research scan-news",
      "stdin": "$first_pass_review.stdout"
    },
    {
      "id": "scan_catalysts",
      "command": "equity-research scan-catalysts",
      "stdin": "$scan_news.stdout"
    },
    {
      "id": "rank_opportunities",
      "command": "equity-research rank-opportunities",
      "stdin": "$scan_catalysts.stdout"
    },
    {
      "id": "review_thesis_depth",
      "command": "equity-research review-thesis-depth",
      "stdin": "$rank_opportunities.stdout"
    },
    {
      "id": "review_risks",
      "command": "equity-research review-risks",
      "stdin": "$review_thesis_depth.stdout"
    },
    {
      "id": "publish_final_report",
      "command": "equity-research publish-final-report",
      "stdin": "$review_risks.stdout"
    }
  ]
}
