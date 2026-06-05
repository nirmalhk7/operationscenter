resource "proxmox_virtual_environment_cluster_options" "options" {
  keyboard   = "en-us"
  mac_prefix = "BC:24:11"
  email_from = "nirmalhk7@gmail.com"
}

resource "proxmox_virtual_environment_cluster_firewall" "options" {
  enabled        = true
  ebtables       = false
  input_policy   = "DROP"
  output_policy  = "ACCEPT"
  forward_policy = "ACCEPT"

  log_ratelimit {
    enabled = false
    burst   = 5
    rate    = "1/second"
  }
}

resource "proxmox_virtual_environment_dns" "milano" {
  node_name = local.nodeName
  domain    = "ns1.cloudflare.com"
  servers   = ["1.1.1.1", "1.0.0.1"]
}

resource "proxmox_virtual_environment_time" "milano" {
  node_name = local.nodeName
  time_zone = "America/Denver"
}

resource "proxmox_virtual_environment_firewall_rules" "inbound" {
  node_name = local.nodeName

  rule {
    action  = "ACCEPT"
    type    = "in"
    source  = "10.0.0.0/24"
    comment = "Allow trusted LAN to reach Proxmox node"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    source  = "172.16.0.0/24"
    comment = "Allow internal bridge to reach Proxmox node"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    source  = "100.64.0.0/10"
    comment = "Allow Tailscale clients to reach Proxmox node"
    enabled = true
  }
}

resource "proxmox_virtual_environment_node_firewall" "options" {
  node_name         = local.nodeName
  enabled           = true
  log_level_in      = "info"
  log_level_out     = "info"
  log_level_forward = "info"
}
