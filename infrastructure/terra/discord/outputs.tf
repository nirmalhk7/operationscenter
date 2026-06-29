output "manager_chat_webhook_url" {
  description = "Discord webhook URL for the manager_chat alerts webhook."
  value       = format("https://discord.com/api/webhooks/%s/%s", discord_webhook.manager_chat.id, discord_webhook.manager_chat.token)
  sensitive   = true
}
