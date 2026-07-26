resource "proxmox_virtual_environment_cluster_firewall_security_group" "sg-managed" {
  name    = "sg-managed"
  comment = "Managed"

  # ALLOWED FROM ANY TO managed resources
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
    type    = "in"
    proto   = "icmp"
    comment = "Allow inbound ICMP wherever SSH is allowed"
  }

  # ALLOWED FROM managed resources TO managed resources
  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "in"
    source  = "+dc/ipset-mgd"
    comment = "Allow managed-to-managed inbound traffic"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    dest    = "+dc/ipset-mgd"
    comment = "Allow managed-to-managed outbound traffic"
  }

  # ALLOWED FROM private Nginx TO Proxmox API
  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    source  = local.proxmoxMachines.nginx.ip
    dest    = local.proxmoxBridgeIp
    proto   = "tcp"
    dport   = "8006"
    comment = "Allow private Nginx to proxy Proxmox API"
  }

  # BLOCKED FROM managed resources TO prohibited destinations
  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    dest    = "8.8.8.8"
    comment = "Block all outbound traffic, including ICMP, to 8.8.8.8"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    proto   = "icmp"
    dest    = "8.8.8.8"
    comment = "Explicitly block outbound ICMP to 8.8.8.8"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    dest    = "10.0.0.0/8"
    comment = "Block outbound traffic to RFC1918 10/8"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    dest    = "172.16.0.0/12"
    comment = "Block outbound traffic to RFC1918 172.16/12"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    dest    = "192.168.0.0/16"
    comment = "Block outbound traffic to RFC1918 192.168/16"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    dest    = "169.254.0.0/16"
    comment = "Block outbound traffic to link-local addresses"
    log     = "info"
  }

  rule {
    enabled = true
    action  = "DROP"
    type    = "out"
    dest    = "100.64.0.0/10"
    comment = "Block outbound traffic to CGNAT and Tailscale addresses"
    log     = "info"
  }

  # ALLOWED FROM managed resources TO public Internet
  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "53,80,443"
    comment = "Allow outbound TCP DNS, HTTP, and HTTPS"
  }

  rule {
    enabled = true
    action  = "ACCEPT"
    type    = "out"
    proto   = "udp"
    dport   = "53"
    comment = "Allow outbound UDP DNS"
  }
}
