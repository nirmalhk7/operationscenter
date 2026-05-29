variable "discord_token" {
  description = "Discord bot token"
  type        = string
  sensitive   = true
}

locals {
  discord_server_id = "1487714737964716084"
  full_permissions  = 2352467520 # SEND_MESSAGES | VIEW_CHANNEL | EMBED_LINKS | ATTACH_FILES | READ_MESSAGE_HISTORY | ADD_REACTIONS | USE_EXTERNAL_EMOJIS | MENTION_EVERYONE | CONNECT | SPEAK | USE_VAD | CHANGE_NICKNAME | USE_APPLICATION_COMMANDS | STREAM
}
