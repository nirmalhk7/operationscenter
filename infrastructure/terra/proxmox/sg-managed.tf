resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-managed" {
  name    = "sg-managed"
  comment = "Managed"

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "in"
    comment = "Allow inbound SSH"
    proto   = "tcp"
    dport   = "22"
    log     = "nolog"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow Nginx to reach k8mgd for trusted subdomains"
    source  = local.proxmoxMachines.nginx.ip
    dest    = local.proxmoxMachines.k8mgd.ip
    proto   = "tcp"
    dport   = "443"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow Nginx to reach Proxmox dashboard"
    source  = local.proxmoxMachines.nginx.ip
    dest    = local.proxmoxBridgeIp
    proto   = "tcp"
    dport   = "8006"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow Nginx to reach home frontend"
    source  = local.proxmoxMachines.nginx.ip
    dest    = local.proxmoxMachines.k8mgd.ip
    proto   = "tcp"
    dport   = "31216"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow Nginx to reach OpenClaw robot service"
    source  = local.proxmoxMachines.nginx.ip
    dest    = local.proxmoxMachines.openclaw.ip
    proto   = "tcp"
    dport   = "18789"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    comment = "Drop connections to managed group members"
    dest    = "+dc/ipset-mgd"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    comment = "Drop outbound SSH"
    proto   = "tcp"
    dport   = "22"
    log     = "nolog"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound DNS over UDP"
    proto   = "udp"
    dport   = "53"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound DNS over TCP"
    proto   = "tcp"
    dport   = "53"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound HTTP"
    proto   = "tcp"
    dport   = "80"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound HTTPS"
    proto   = "tcp"
    dport   = "443"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    comment = "Drop all other outbound traffic"
    log     = "info"
  }
}
