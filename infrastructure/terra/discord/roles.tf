resource "discord_role" "swe" {
  server_id   = local.discord_server_id
  name        = "SWE"
  permissions = local.full_permissions
  color       = 3447003 # 3498db blue
  hoist       = true
  mentionable = true
}

resource "discord_role" "business" {
  server_id   = local.discord_server_id
  name        = "Business"
  permissions = local.full_permissions
  color       = 15844367 # f1c40f yellow
  hoist       = true
  mentionable = true
}

resource "discord_role" "equities" {
  server_id   = local.discord_server_id
  name        = "Investment Analyst"
  permissions = local.full_permissions
  color       = 3066993 # 2ecc71 green
  hoist       = true
  mentionable = true
}

resource "discord_role" "managers" {
  server_id   = local.discord_server_id
  name        = "Managers"
  permissions = local.full_permissions
  color       = 10070709 # 99aab5 grey-blue
  hoist       = true
  mentionable = true
}
