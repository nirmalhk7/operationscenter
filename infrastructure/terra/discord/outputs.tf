output "manager_chat_webhook_url" {
  description = "Discord webhook URL for the manager_chat alerts webhook."
  value       = format("https://discord.com/api/webhooks/%s/%s", discord_webhook.manager_chat.id, discord_webhook.manager_chat.token)
  sensitive   = true
}

output "flux_reconciliation_alerts_webhook_url" {
  description = "Discord webhook URL for Flux reconciliation alerts."
  value       = format("https://discord.com/api/webhooks/%s/%s", discord_webhook.flux_reconciliation_alerts.id, discord_webhook.flux_reconciliation_alerts.token)
  sensitive   = true
}
