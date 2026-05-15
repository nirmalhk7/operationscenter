resource "discord_category_channel" "general" {
  server_id = local.discord_server_id
  name      = "🎖️ CENTCOM"
  position  = 1
}

resource "discord_category_channel" "software" {
  server_id = local.discord_server_id
  name      = "💻 Team Software"
  position  = 2
}

resource "discord_category_channel" "bizanalytics" {
  server_id = local.discord_server_id
  name      = "📊 Entrepreneurs Club"
  position  = 3
}

resource "discord_category_channel" "equities" {
  server_id = local.discord_server_id
  name      = "📈 Equities and Markets"
  position  = 4
}

resource "discord_category_channel" "voice" {
  server_id = local.discord_server_id
  name      = "🔊 Voice"
  position  = 5
}
