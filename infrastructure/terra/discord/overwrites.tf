# CENTCOM: deny everyone at category level (general is visible to nobody)
resource "discord_channel_permission" "centcom_deny_everyone" {
  channel_id   = discord_category_channel.general.channel_id
  type         = "role"
  overwrite_id = local.discord_server_id
  deny         = 1024 # VIEW_CHANNEL
}

# manager-chat and manager-standup: allow Managers at channel level
resource "discord_channel_permission" "manager_chat_allow_managers" {
  channel_id   = discord_text_channel.manager_chat.id
  type         = "role"
  overwrite_id = discord_role.managers.id
  allow        = 1024 # VIEW_CHANNEL
}

resource "discord_channel_permission" "manager_standup_allow_managers" {
  channel_id   = discord_forum_channel.manager_standup.id
  type         = "role"
  overwrite_id = discord_role.managers.id
  allow        = 1024 # VIEW_CHANNEL
}

# Lock Voice from everyone
resource "discord_channel_permission" "voice_deny_everyone" {
  channel_id   = discord_category_channel.voice.channel_id
  type         = "role"
  overwrite_id = local.discord_server_id
  deny         = 1024 # VIEW_CHANNEL
}

# Let only NestorBot into the voice category so the main agent can listen and speak in General.
resource "discord_channel_permission" "voice_allow_nestor" {
  channel_id   = discord_category_channel.voice.channel_id
  type         = "user"
  overwrite_id = local.nestor_bot_user_id
  allow        = 3146752 # VIEW_CHANNEL | CONNECT | SPEAK
}

# Restrict Team Software to SWE only
resource "discord_channel_permission" "software_deny_everyone" {
  channel_id   = discord_category_channel.software.channel_id
  type         = "role"
  overwrite_id = local.discord_server_id
  deny         = 1024 # VIEW_CHANNEL
}

resource "discord_channel_permission" "software_allow_swe" {
  channel_id   = discord_category_channel.software.channel_id
  type         = "role"
  overwrite_id = discord_role.swe.id
  allow        = 1024 # VIEW_CHANNEL
}

# Restrict Entrepreneurs Club to Business only
resource "discord_channel_permission" "bizanalytics_deny_everyone" {
  channel_id   = discord_category_channel.bizanalytics.channel_id
  type         = "role"
  overwrite_id = local.discord_server_id
  deny         = 1024 # VIEW_CHANNEL
}

resource "discord_channel_permission" "bizanalytics_allow_business" {
  channel_id   = discord_category_channel.bizanalytics.channel_id
  type         = "role"
  overwrite_id = discord_role.business.id
  allow        = 1024 # VIEW_CHANNEL
}

# Restrict Equities and Markets to Investment Analyst only
resource "discord_channel_permission" "equities_deny_everyone" {
  channel_id   = discord_category_channel.equities.channel_id
  type         = "role"
  overwrite_id = local.discord_server_id
  deny         = 1024 # VIEW_CHANNEL
}

resource "discord_channel_permission" "equities_allow_investment_analyst" {
  channel_id   = discord_category_channel.equities.channel_id
  type         = "role"
  overwrite_id = discord_role.equities.id
  allow        = 1024 # VIEW_CHANNEL
}
