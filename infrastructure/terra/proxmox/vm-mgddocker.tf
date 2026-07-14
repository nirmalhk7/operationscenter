resource "proxmox_virtual_environment_vm" "vm-k8docker" {
  name        = "k8docker"
  description = "Managed by Terraform"
  tags        = ["debian"]

  node_name = local.nodeName
  vm_id     = local.proxmoxMachines.k8docker.vm_id


  agent {
    enabled = true
  }

  # if agent is not enabled, the VM may not be able to shutdown properly, and may need to be forced off
  stop_on_destroy = true

  on_boot = true

  pool_id = proxmox_virtual_environment_pool.pool-mgd.id

  cpu {
    cores = 2
    type  = "x86-64-v2-AES" # recommended for modern CPUs
  }

  memory {
    dedicated = 4096
    floating  = 4096
  }

  disk {
    datastore_id = "local"
    import_from  = proxmox_virtual_environment_download_file.debian-13-generic-amd64-qcow2.id
    interface    = "scsi0"
    size         = 20
  }


  initialization {
    datastore_id = "local"
    ip_config {
      ipv4 {
        address = local.proxmoxMachines.k8docker.cidr
        gateway = local.proxmoxBridgeIp
      }
    }

    user_account {
      password = "${var.vm_password}${local.proxmoxMachines.k8docker.vm_id}"
      keys     = [local.sshKeys.mgd]
      username = "root"
    }

    user_data_file_id = proxmox_virtual_environment_file.cloud_config.id
  }

  network_device {
    bridge   = "wmnet"
    firewall = false
  }

  operating_system {
    type = "l26"
  }

  efi_disk {
    datastore_id = "local"
  }

  tpm_state {
    datastore_id = "local"
  }

  serial_device {}
}

resource "proxmox_virtual_environment_firewall_rules" "lxc-vm-mgddocker-sg" {
  depends_on = [
    proxmox_virtual_environment_vm.vm-k8docker,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_vm.vm-k8docker.vm_id

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
    dport   = "3306"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow MariaDB from nginx stream proxy"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "5432"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow PostgreSQL from nginx stream proxy"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "27017"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow MongoDB from nginx stream proxy"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "3306"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow MariaDB from k8mgd"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "5432"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow PostgreSQL from k8mgd"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "27017"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow MongoDB from k8mgd"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "2375"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow Homepage Docker discovery from k8mgd"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "8080"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow Prometheus to scrape cAdvisor"
    iface   = "net0"
    enabled = true
  }
}

resource "proxmox_virtual_environment_firewall_options" "vm-k8docker-config" {
  depends_on = [proxmox_virtual_environment_vm.vm-k8docker]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_vm.vm-k8docker.vm_id

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
