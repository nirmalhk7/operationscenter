# ── CENTCOM ───────────────────────────────────────────────────────────────────

resource "discord_text_channel" "centcom_general" {
  server_id                = local.discord_server_id
  name                     = "general"
  category                 = discord_category_channel.general.id
  sync_perms_with_category = true
}

resource "discord_text_channel" "manager_chat" {
  server_id                = local.discord_server_id
  name                     = "manager-chat"
  category                 = discord_category_channel.general.id
  sync_perms_with_category = false
}

resource "discord_forum_channel" "manager_standup" {
  server_id                = local.discord_server_id
  name                     = "manager-standup"
  category                 = discord_category_channel.general.id
  sync_perms_with_category = false
}

# ── Team Software ─────────────────────────────────────────────────────────────

resource "discord_text_channel" "software_general" {
  server_id                = local.discord_server_id
  name                     = "general"
  category                 = discord_category_channel.software.id
  sync_perms_with_category = true
}

# ── Entrepreneurs Club ────────────────────────────────────────────────────────

resource "discord_text_channel" "analytics_general" {
  server_id                = local.discord_server_id
  name                     = "general"
  category                 = discord_category_channel.bizanalytics.id
  sync_perms_with_category = true
}

# ── Equities and Markets ──────────────────────────────────────────────────────

resource "discord_text_channel" "equities_general" {
  server_id                = local.discord_server_id
  name                     = "general"
  category                 = discord_category_channel.equities.id
  sync_perms_with_category = true
}

# ── Voice ─────────────────────────────────────────────────────────────────────

resource "discord_voice_channel" "general_voice" {
  server_id                = local.discord_server_id
  name                     = "General"
  category                 = discord_category_channel.voice.id
  sync_perms_with_category = true
}
