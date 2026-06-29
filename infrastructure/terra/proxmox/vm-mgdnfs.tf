resource "proxmox_virtual_environment_vm" "vm-mgdnfs1" {
  name        = "mgdnfs1"
  description = "Managed by Terraform"
  tags        = ["debian"]

  node_name = local.nodeName
  vm_id     = local.proxmoxMachines.mgdnfs1.vm_id
  boot_order = [
    "scsi0",
    "net0",
    "scsi1"
  ]
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
    dedicated = 2048
    floating  = 1024
  }

  disk {
    datastore_id = "local"
    import_from  = proxmox_virtual_environment_download_file.debian-13-generic-amd64-qcow2.id
    interface    = "scsi0"
    size         = 3
  }

  disk {
    backup       = true
    cache        = "none"
    datastore_id = "hdd"
    discard      = "ignore"
    file_format  = "qcow2"
    interface    = "scsi1"
    iothread     = false
    replicate    = true
    size         = 32
    ssd          = false
  }


  initialization {
    datastore_id = "local"
    ip_config {
      ipv4 {
        address = local.proxmoxMachines.mgdnfs1.cidr
        gateway = local.proxmoxBridgeIp
      }
    }

    user_account {
      password = "${var.vm_password}${local.proxmoxMachines.mgdnfs1.vm_id}"
      keys     = [local.sshKeys.mgd]
      username = "root"
    }

    user_data_file_id = proxmox_virtual_environment_file.cloud_config.id
  }



  network_device {
    bridge   = "wmnet"
    firewall = true
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

resource "proxmox_virtual_environment_firewall_rules" "lxc-vm-mgdnfs1-sg" {
  depends_on = [
    proxmox_virtual_environment_vm.vm-mgdnfs1,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_vm.vm-mgdnfs1.vm_id

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
    dport   = "2049"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow NFS ingress"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "111"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow RPC bind TCP ingress"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "udp"
    dport   = "111"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow RPC bind UDP ingress"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "icmp"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow ping from k8mgd for NFS reachability checks"
    iface   = "net0"
    enabled = true
  }
}

resource "proxmox_virtual_environment_firewall_options" "vm-mgdnfs1-config" {
  depends_on = [proxmox_virtual_environment_vm.vm-mgdnfs1]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_vm.vm-mgdnfs1.vm_id

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
