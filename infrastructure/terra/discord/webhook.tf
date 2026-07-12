resource "discord_webhook" "manager_chat" {
  channel_id = discord_text_channel.manager_chat.id
  name       = "ops-center-alerts"
}

resource "discord_webhook" "flux_reconciliation_alerts" {
  channel_id = "1504282225770889226"
  name       = "flux-reconciliation-alerts"
}
