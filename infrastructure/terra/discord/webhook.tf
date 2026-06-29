resource "discord_webhook" "manager_chat" {
  channel_id = discord_text_channel.manager_chat.id
  name       = "ops-center-alerts"
}
