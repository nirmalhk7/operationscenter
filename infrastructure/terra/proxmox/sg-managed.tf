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
    action  = "DROP"
    type    = "out"
    comment = "Drop connections to managed group members"
    dest    = "+dc/ipset-mgd"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow Nginx to reach k8mgd for trusted subdomains"
    source  = "172.16.0.101"
    dest    = "172.16.0.105"
    proto   = "tcp"
    dport   = "443"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow Nginx to reach Proxmox dashboard"
    source  = "172.16.0.101"
    dest    = "172.16.0.1"
    proto   = "tcp"
    dport   = "8006"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow Nginx to reach OpenClaw robot service"
    source  = "172.16.0.101"
    dest    = "172.16.0.104"
    proto   = "tcp"
    dport   = "18789"
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
    log     = "info"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound DNS over TCP"
    proto   = "tcp"
    dport   = "53"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound HTTP"
    proto   = "tcp"
    dport   = "80"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    comment = "Allow outbound HTTPS"
    proto   = "tcp"
    dport   = "443"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    comment = "Drop all other outbound traffic"
    log     = "info"
  }
}
