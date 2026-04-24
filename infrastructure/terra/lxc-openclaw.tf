resource "proxmox_virtual_environment_container" "lxc-openclaw" {

  description = "openclaw"
  node_name   = local.nodeName
  vm_id       = 104
  tags        = ["mgd"]
  pool_id     = proxmox_virtual_environment_pool.pool-mgd.pool_id

  initialization {
    hostname = "openclaw"

    ip_config {
      ipv4 {
        address = "${local.machineSubnet}104/24"
        gateway = "${local.machineSubnet}1"
      }
    }

    user_account {
      keys     = [local.sshKeys.mgd]
      password = "${var.vm_password}104"
    }
  }

  network_interface {
    bridge   = "wmnet"
    name     = "net0"
    enabled  = true
    firewall = false

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
    size         = 8
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
  depends_on = [
    proxmox_virtual_environment_container.lxc-openclaw,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_container.lxc-openclaw.vm_id

  rule {
    security_group = proxmox_virtual_environment_cluster_firewall_security_group.sg-managed.name
    comment        = "Dev Test"
    iface          = "net0"
    enabled        = true
  }
}

resource "proxmox_virtual_environment_firewall_options" "lxc-openclaw-config" {
  depends_on = [proxmox_virtual_environment_container.lxc-openclaw]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_container.lxc-openclaw.vm_id

  enabled = false
}