resource "proxmox_virtual_environment_vm" "vm-k8mgd" {
  name        = "k8mgd"
  description = "Managed by Terraform"
  tags        = ["debian"]

  node_name = local.nodeName
  vm_id     = 105

  agent {
    enabled = true
  }

  # if agent is not enabled, the VM may not be able to shutdown properly, and may need to be forced off
  stop_on_destroy = true

  on_boot = true

  pool_id = proxmox_virtual_environment_pool.pool-mgd.id

  cpu {
    cores = 4
    type  = "x86-64-v2-AES" # recommended for modern CPUs
  }

  memory {
    dedicated = 1024 * 15
    floating  = 1024 * 6
  }

  disk {
    datastore_id = "local"
    import_from  = proxmox_virtual_environment_download_file.debian-13-generic-amd64-qcow2.id
    interface    = "scsi0"
    size         = 100
  }


  initialization {
    datastore_id = "local"
    ip_config {
      ipv4 {
        address = "${local.machineSubnet}105/24"
        gateway = "${local.machineSubnet}1"
      }
    }

    user_account {
      password = "${var.vm_password}105"
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

resource "proxmox_virtual_environment_firewall_rules" "lxc-vm-mgdk-sg" {
  depends_on = [
    proxmox_virtual_environment_vm.vm-k8mgd,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_vm.vm-k8mgd.vm_id

  rule {
    security_group = proxmox_virtual_environment_cluster_firewall_security_group.sg-managed.name
    comment        = "Dev Test"
    iface          = "net0"
    enabled        = false
  }
}