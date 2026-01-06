terraform {
  required_version = ">= 0.13.0"
  required_providers {
    proxmox = {
      source = "bpg/proxmox"
      version = "0.88.0"
    }
  }
}

provider "proxmox" {
  endpoint = var.pm_api_url
  username = var.pm_user
  password = var.pm_password
  insecure = true
  ssh {
    agent = true
  }
}