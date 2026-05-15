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
