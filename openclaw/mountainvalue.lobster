{
  "name": "mountainvalue-daily-equity-research",
  "steps": [
    {
      "id": "sec_seed",
      "command": "equity-research sec-seed"
    },
    {
      "id": "finviz_seed",
      "command": "equity-research finviz-seed",
      "stdin": "$sec_seed.stdout"
    },
    {
      "id": "finviz_technical_seed",
      "command": "equity-research finviz-technical-seed",
      "stdin": "$finviz_seed.stdout"
    },
    {
      "id": "merge_seed_pool",
      "command": "equity-research merge-seed-pool",
      "stdin": "$finviz_technical_seed.stdout"
    },
    {
      "id": "sec_filing_search",
      "command": "equity-research sec-filing-search",
      "stdin": "$merge_seed_pool.stdout"
    },
    {
      "id": "quantsieve_review",
      "command": "equity-research quantsieve-review",
      "stdin": "$sec_filing_search.stdout"
    },
    {
      "id": "eventhound_scan",
      "command": "equity-research eventhound-scan",
      "stdin": "$quantsieve_review.stdout"
    },
    {
      "id": "narrow_pool",
      "command": "equity-research narrow-pool",
      "stdin": "$eventhound_scan.stdout"
    },
    {
      "id": "riskskeptic_review",
      "command": "equity-research riskskeptic-review",
      "stdin": "$narrow_pool.stdout"
    },
    {
      "id": "oracle_finalize",
      "command": "equity-research oracle-finalize",
      "stdin": "$riskskeptic_review.stdout"
    }
  ]
}
