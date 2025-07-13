locals {
  cloudflare = {
    resourceId = 201
  }
}

resource "proxmox_lxc" "cloudflare" {
  target_node  = "milano"
  hostname     = "cloudflare"
  vmid         = local.cloudflare.resourceId
  password     = "${var.lxc_password}${local.cloudflare.resourceId}"
  unprivileged = true
  tags         = "mgd"

  ostemplate = local.os_templates.debian12

  cores  = 2
  memory = 1024
  swap   = 1024

  rootfs {
    storage = "local"
    size    = "5G"
  }

  network {
    name   = "eth0"
    bridge = "wmnet"
    ip     = "172.16.0.${local.cloudflare.resourceId}/24"
    gw     = "172.16.0.0"
  }

  nameserver = "1.1.1.1"

  start = true
}
