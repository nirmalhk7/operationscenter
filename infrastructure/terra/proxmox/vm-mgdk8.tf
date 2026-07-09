resource "proxmox_virtual_environment_vm" "vm-k8mgd" {
  name        = "k8mgd"
  description = "Managed by Terraform"
  tags        = ["debian"]

  node_name = local.nodeName
  vm_id     = local.proxmoxMachines.k8mgd.vm_id

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
    dedicated = 1024 * 16
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
        address = local.proxmoxMachines.k8mgd.cidr
        gateway = local.proxmoxBridgeIp
      }
    }

    user_account {
      password = "${var.vm_password}${local.proxmoxMachines.k8mgd.vm_id}"
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

resource "proxmox_virtual_environment_firewall_rules" "lxc-vm-mgdk-sg" {
  depends_on = [
    proxmox_virtual_environment_vm.vm-k8mgd,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_vm.vm-k8mgd.vm_id

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
    dport   = "6443"
    comment = "Allow Kubernetes API ingress"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "443"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow Nginx to reach k8mgd for wildcard trusted subdomains"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "8443"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow Nginx tunnel origin to reach Traefik livepublic on k8mgd"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "31216"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow Nginx to reach local Homepage on k8mgd"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "32222"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow Nginx to reach Gitea SSH on k8mgd"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "30901"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow Nginx to reach Minecraft Java stream on k8mgd"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "udp"
    dport   = "30902"
    source  = local.proxmoxMachines.nginx.ip
    comment = "Allow Nginx to reach Minecraft Bedrock stream on k8mgd"
    iface   = "net0"
    enabled = true
  }
}

resource "proxmox_virtual_environment_firewall_options" "vm-k8mgd-config" {
  depends_on = [proxmox_virtual_environment_vm.vm-k8mgd]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_vm.vm-k8mgd.vm_id

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
