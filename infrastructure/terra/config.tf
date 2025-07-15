resource "proxmox_virtual_environment_cluster_options" "options" {
  keyboard   = "en-us"
  mac_prefix = "BC:24:11"
  email_from = "nirmalhk7@gmail.com"
}

resource "proxmox_virtual_environment_cluster_firewall" "options" {
  enabled = true  
  
}

resource "proxmox_virtual_environment_dns" "milano" {
  node_name = "milano"
  domain    = "ns1.cloudflare.com"
  servers   = ["1.1.1.1", "1.0.0.1"]
}

resource "proxmox_virtual_environment_time" "milano" {
  node_name  = "milano"
  time_zone  = "America/Denver"
}

resource "proxmox_virtual_environment_firewall_rules" "inbound" {
  node_name = "milano"

  rule {
    type    = "in"
    action  = "ACCEPT"
    comment = "Allow HTTP"
    source  = local.machineIp
    dport   = "80"
    proto   = "tcp"
    log     = "nolog"
    enabled = true
  }

  rule {
    type    = "in"
    action  = "ACCEPT"
    comment = "Allow HTTPS"
    dest    = local.machineIp
    dport   = "443"
    proto   = "tcp"
    log     = "nolog"
    enabled = true
  }

  rule {
    type    = "in"
    action  = "ACCEPT"
    comment = "Allow SSH"
    dest    = local.machineIp
    dport   = "22"
    proto   = "tcp"
    log     = "nolog"
    enabled = true
  }

  rule {
    type    = "out"
    action  = "ACCEPT"
    comment = "All external traffic"
    dest    = local.machineIp
    proto   = "tcp"
    log     = "nolog"
    enabled = true
  }
}