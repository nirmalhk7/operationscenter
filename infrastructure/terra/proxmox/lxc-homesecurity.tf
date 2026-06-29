resource "proxmox_virtual_environment_container" "lxc-homesecurity" {

  description = "Home WiFi LAN monitoring stack"
  node_name   = local.nodeName
  vm_id       = local.proxmoxMachines.homesecurity.vm_id
  tags        = ["mgd"]
  pool_id     = proxmox_virtual_environment_pool.pool-mgd.pool_id

  initialization {
    hostname = "homesecurity"

    ip_config {
      ipv4 {
        address = local.proxmoxMachines.homesecurity.cidr
        gateway = local.proxmoxBridgeIp
      }
    }

    dns {
      servers = ["1.1.1.1", "1.0.0.1"]
    }

    user_account {
      keys     = [local.sshKeys.mgd]
      password = "${var.vm_password}${local.proxmoxMachines.homesecurity.vm_id}"
    }
  }

  network_interface {
    bridge   = "wmnet"
    name     = "net0"
    enabled  = true
    firewall = true
  }

  memory {
    dedicated = 1024
  }

  cpu {
    architecture = "amd64"
    cores        = 2
  }

  disk {
    datastore_id = "local"
    size         = 20
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

resource "proxmox_virtual_environment_firewall_rules" "lxc-homesecurity-sg" {
  depends_on = [
    proxmox_virtual_environment_container.lxc-homesecurity,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_container.lxc-homesecurity.vm_id

  rule {
    security_group = proxmox_virtual_environment_cluster_firewall_security_group.sg-managed.name
    comment        = "Managed Group Rules"
    iface          = "net0"
    enabled        = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "9115"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow Prometheus to scrape blackbox_exporter"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "9427"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow Prometheus to scrape network_exporter"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "9798"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow Prometheus to scrape speedtest_exporter"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "9919"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow Prometheus to scrape openport_exporter"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "20211"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow Nginx to reach NetAlertX UI"
    iface   = "net0"
    enabled = true
  }
}

resource "proxmox_virtual_environment_firewall_options" "lxc-homesecurity-config" {
  depends_on = [proxmox_virtual_environment_container.lxc-homesecurity]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_container.lxc-homesecurity.vm_id

  enabled       = true
  input_policy  = "DROP"
  output_policy = "ACCEPT"
  ipfilter      = false
  macfilter     = true
  ndp           = false
  radv          = false
  log_level_in  = "info"
  log_level_out = "info"
}
