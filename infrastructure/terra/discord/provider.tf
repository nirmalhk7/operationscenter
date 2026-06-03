terraform {
  required_version = ">= 0.13.0"
  required_providers {
    discord = {
      source  = "Lucky3028/discord"
      version = "2.7.0"
    }
  }
}

provider "discord" {
  token = var.discord_token
}
