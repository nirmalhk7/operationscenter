variable "pm_api_url" {
  description = "Proxmox API URL"
  type        = string
}

variable "pm_user" {
  description = "Proxmox user"
  type        = string
}

variable "pm_password" {
  description = "Proxmox password"
  type        = string
  sensitive   = true
}

variable "lxc_password" {
  description = "LXC password"
  type        = string
  sensitive   = true
}

variable "vm_password" {
  description = "VM password"
  type        = string
  sensitive   = true
}

locals {
  osTemplates = {
    debian12 = "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"
    debian11 = "local:vztmpl/debian-11-standard_11.7-1_amd64.tar.zst"
    ubuntu22 = "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
    ubuntu20 = "local:vztmpl/ubuntu-20.04-standard_20.04-1_amd64.tar.zst"
    alpine   = "local:vztmpl/alpine-3.18-default_20230607_amd64.tar.xz"
    centos9  = "local:vztmpl/centos-9-stream-default_20221109_amd64.tar.xz"
  }
  osISOs = {
    ubuntu    = "local:iso/ubuntu-22.04.2-desktop-amd64.iso"
    kalilinux = "local:iso/kali-linux-2024.4-installer-netinst-amd64.iso"
    debian    = "local:iso/debian-12.9.0-amd64-DVD-1.iso"
    alpine    = "local:iso/alpine-standard-3.21.3-x86_64.iso"
  }
  machineIp     = "10.0.0.10"
  machineSubnet = "172.16.0."
  machinePrefix = 24
  nodeName      = "milano"

  proxmoxBridgeIp   = "${local.machineSubnet}1"
  proxmoxBridgeCidr = "${local.machineSubnet}1/${local.machinePrefix}"

  proxmoxMachines = {
    nginx = {
      vm_id = 101
      ip    = "${local.machineSubnet}101"
      cidr  = "${local.machineSubnet}101/${local.machinePrefix}"
    }
    proxbridge = {
      vm_id = 102
      ip    = "${local.machineSubnet}102"
      cidr  = "${local.machineSubnet}102/${local.machinePrefix}"
    }
    homesecurity = {
      vm_id = 103
      ip    = "${local.machineSubnet}103"
      cidr  = "${local.machineSubnet}103/${local.machinePrefix}"
    }
    openclaw = {
      vm_id = 104
      ip    = "${local.machineSubnet}104"
      cidr  = "${local.machineSubnet}104/${local.machinePrefix}"
    }
    k8mgd = {
      vm_id = 105
      ip    = "${local.machineSubnet}105"
      cidr  = "${local.machineSubnet}105/${local.machinePrefix}"
    }
    k8docker = {
      vm_id = 106
      ip    = "${local.machineSubnet}106"
      cidr  = "${local.machineSubnet}106/${local.machinePrefix}"
    }
    mgdnfs1 = {
      vm_id = 107
      ip    = "${local.machineSubnet}107"
      cidr  = "${local.machineSubnet}107/${local.machinePrefix}"
    }
  }

  sshKeys = {
    mgd = trimspace(file("~/.ssh/id_ed25519_homelab.pub"))
  }
}
