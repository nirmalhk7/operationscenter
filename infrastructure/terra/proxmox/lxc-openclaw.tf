resource "proxmox_virtual_environment_container" "lxc-openclaw" {

  description = "openclaw"
  node_name   = local.nodeName
  vm_id       = local.proxmoxMachines.openclaw.vm_id
  tags        = ["mgd"]
  pool_id     = proxmox_virtual_environment_pool.pool-mgd.pool_id

  initialization {
    hostname = "openclaw"

    ip_config {
      ipv4 {
        address = local.proxmoxMachines.openclaw.cidr
        gateway = local.proxmoxBridgeIp
      }
    }

    dns {
      servers = ["1.1.1.1", "1.0.0.1"]
    }

    user_account {
      keys     = [local.sshKeys.mgd]
      password = "${var.vm_password}${local.proxmoxMachines.openclaw.vm_id}"
    }
  }

  network_interface {
    bridge   = "wmnet"
    name     = "net0"
    enabled  = true
    firewall = true

  }

  memory {
    dedicated = 1024 * 4
    swap      = 1024 * 2
  }

  cpu {
    architecture = "amd64"
    cores        = 2
  }

  disk {
    datastore_id = "local"
    size         = 24
  }

  console {
    enabled   = true
    tty_count = 2
    type      = "tty"
  }



  operating_system {
    template_file_id = local.osTemplates.debian12
    type             = "debian"
  }

  features {
    nesting = true
  }
}

resource "proxmox_virtual_environment_firewall_rules" "lxc-openclaw-sg" {
  depends_on = [proxmox_virtual_environment_container.lxc-openclaw]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_container.lxc-openclaw.vm_id

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "22"
    comment = "Allow SSH to OpenClaw"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "9100"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow Prometheus to scrape OpenClaw node metrics"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "18789"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow Nginx to reach OpenClaw robot service"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "18789"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow Paperclip on k8mgd to reach OpenClaw gateway"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dest    = local.proxmoxMachines.k8mgd.ip
    dport   = "6443"
    comment = "Allow outbound to k8mgd Kubernetes API"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    sport   = "22"
    comment = "Allow SSH reply traffic from OpenClaw"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "DROP"
    type    = "out"
    dest    = "10.0.0.0/8"
    comment = "Block outbound to RFC1918 10/8"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  rule {
    action  = "DROP"
    type    = "out"
    dest    = "172.16.0.0/12"
    comment = "Block outbound to RFC1918 172.16/12"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  rule {
    action  = "DROP"
    type    = "out"
    dest    = "192.168.0.0/16"
    comment = "Block outbound to RFC1918 192.168/16"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  rule {
    action  = "DROP"
    type    = "out"
    dest    = "100.64.0.0/10"
    comment = "Block outbound to CGNAT and Tailscale range"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "80"
    comment = "Allow outbound HTTP to public internet"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "443"
    comment = "Allow outbound HTTPS to public internet"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "udp"
    dport   = "1024:65535"
    comment = "Allow outbound Discord voice RTP media to public internet"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "2083"
    comment = "Allow outbound alternate HTTPS for Discord media latency checks"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "8443"
    comment = "Allow outbound alternate HTTPS for Discord media latency checks"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "53"
    comment = "Allow outbound TCP DNS to public internet"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "udp"
    dport   = "53"
    comment = "Allow outbound UDP DNS to public internet"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "udp"
    dport   = "123"
    comment = "Allow outbound NTP to public internet"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    source  = local.proxmoxMachines.k8mgd.ip
    sport   = "6443"
    comment = "Allow k8mgd Kubernetes API replies to OpenClaw"
    iface   = "net0"
    enabled = true
  }
}

resource "proxmox_virtual_environment_firewall_options" "lxc-openclaw-config" {
  depends_on = [proxmox_virtual_environment_container.lxc-openclaw]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_container.lxc-openclaw.vm_id

  enabled       = true
  input_policy  = "DROP"
  output_policy = "DROP"
  ipfilter      = false
  macfilter     = false
  ndp           = false
  radv          = false
  log_level_in  = "info"
  log_level_out = "info"
}
