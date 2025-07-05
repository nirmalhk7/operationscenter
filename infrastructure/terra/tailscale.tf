locals {
  tailscale = {
    resourceId = 211
  }
}

resource "proxmox_lxc" "testlxc" {
  target_node  = "milano"
  hostname     = "tailscale"
  vmid         = local.tailscale.resourceId
  password     = "${var.lxc_password}${local.tailscale.resourceId}"
  unprivileged = true
  tags         = "mgd"

  ostemplate = local.os_templates.debian12

  cores  = 2
  memory = 512
  swap   = 512

  rootfs {
    storage = "local"
    size    = "8G"
  }

  network {
    name   = "eth0"
    bridge = "wmnet"
    ip     = "172.16.0.${local.tailscale.resourceId}/24"
    gw     = "172.16.0.0"
  }

  nameserver = "1.1.1.1"

  start = true
}
