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
    dedicated = 1024 * 2
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
    dport   = "18789"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow Nginx to reach OpenClaw robot service"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    dest    = local.proxmoxMachines.nginx.ip
    comment = "Allow outbound to Nginx"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    dest    = local.proxmoxMachines.k8mgd.ip
    comment = "Allow outbound to k8mgd"
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
  macfilter     = true
  ndp           = false
  radv          = false
  log_level_in  = "info"
  log_level_out = "info"
}
