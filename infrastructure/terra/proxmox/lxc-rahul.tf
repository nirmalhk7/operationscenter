resource "proxmox_virtual_environment_container" "lxc-mgd-rahul" {
  description = "Rahul isolated OpenClaw cluster manager"
  node_name   = local.nodeName
  vm_id       = local.proxmoxMachines.rahul.vm_id
  tags        = ["mgd"]
  pool_id     = proxmox_virtual_environment_pool.pool-mgd.pool_id

  initialization {
    hostname = "rahul"

    ip_config {
      ipv4 {
        address = local.proxmoxMachines.rahul.cidr
        gateway = local.proxmoxBridgeIp
      }
    }

    dns {
      servers = ["1.1.1.1", "1.0.0.1"]
    }

    user_account {
      keys     = [local.sshKeys.mgd]
      password = "${var.vm_password}${local.proxmoxMachines.rahul.vm_id}"
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
    swap      = 1024
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

resource "proxmox_virtual_environment_firewall_rules" "lxc-mgd-rahul-sg" {
  depends_on = [proxmox_virtual_environment_container.lxc-mgd-rahul]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_container.lxc-mgd-rahul.vm_id

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "22"
    comment = "Allow SSH to Rahul"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "9100"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow Prometheus to scrape Rahul node metrics"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dest    = local.proxmoxMachines.k8mgd.ip
    dport   = "6443"
    comment = "Allow Rahul Kubernetes API read access"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "53,80,443"
    comment = "Allow Rahul DNS and public API access"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "udp"
    dport   = "53,1024:65535"
    comment = "Allow Rahul DNS and Discord media"
    iface   = "net0"
    enabled = true
  }
}

resource "proxmox_virtual_environment_firewall_options" "lxc-mgd-rahul-config" {
  depends_on = [proxmox_virtual_environment_container.lxc-mgd-rahul]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_container.lxc-mgd-rahul.vm_id

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
