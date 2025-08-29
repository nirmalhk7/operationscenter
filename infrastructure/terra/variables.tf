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
    debian12  = "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"
    debian11  = "local:vztmpl/debian-11-standard_11.7-1_amd64.tar.zst"
    ubuntu22  = "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
    ubuntu20  = "local:vztmpl/ubuntu-20.04-standard_20.04-1_amd64.tar.zst"
    alpine    = "local:vztmpl/alpine-3.18-default_20230607_amd64.tar.xz"
    centos9   = "local:vztmpl/centos-9-stream-default_20221109_amd64.tar.xz"
  }
  osISOs = {
    ubuntu    = "local:iso/ubuntu-22.04.2-desktop-amd64.iso"
    kalilinux = "local:iso/kali-linux-2024.4-installer-netinst-amd64.iso"
    debian = "local:iso/debian-12.9.0-amd64-DVD-1.iso"
    alpine = "local:iso/alpine-standard-3.21.3-x86_64.iso"
  }
  machineIp = "10.0.0.10"
  machineSubnet = "172.16.0."
  nodeName = "milano"

  sshKeys = {
    dev = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC/o7uyyBuox60RM8njxohbybPxPbyGlYiCkywkRgx4W1pkOTAsOfRKhzOLHLLdXgaThsr74zMRv/MIvJMejyW5k39tPn2eafo1/RfNWlgsu5kwtqnKwEh3xKI/vXvKFZSKlMev40pF6ITp6KHBYUzNPNSi8MqW9kXnbtYIUfl1WcHzl5Sxlk2eNNesdIv3vS4BUBVz0ohkCcUwWM8oah1U6FgZdMDuvS6iq9MErwoYS1XCJuygaqGamdrjNPkgwoCS1w4VNd4prooyrx8OQ4kUZd/ulEDmqzsq2CNyEA90Jb+NJCMTGGfXsQTSbDmMKX2E5qC3wrbf3744nagL23fyy3k0+x7YLdt/LOPEoFvPF6WMSYERPkOQinNG98057rqzLiqc00+3XIUhaG8P/2oc+EGx7EdJa6+bLiYQEacdaz23boxYxx81SMVm0E3OlPIrY0JMkwQzYRvrd56vlgB3EWFHQXjrhFsr6yCTGLEDL2e/+0RY44Z//od3khnv5DujqCdetiuNKbxBo/v2iL4TJunZh9vJw9qzgYC8z5kHSaU3nuvqYZ5AIthKUdbPN5HnUgQAxXNyLMtzntot4+E/cedQpDlZc6Xfd3shZO9gnHTdVw1YpAi99/nNnwFh5GEz4jWtuxfgyNObduOSbOtO7so4RvAmj0Kif4BlR/HPxQ== root@milano"
    mgd = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC/o7uyyBuox60RM8njxohbybPxPbyGlYiCkywkRgx4W1pkOTAsOfRKhzOLHLLdXgaThsr74zMRv/MIvJMejyW5k39tPn2eafo1/RfNWlgsu5kwtqnKwEh3xKI/vXvKFZSKlMev40pF6ITp6KHBYUzNPNSi8MqW9kXnbtYIUfl1WcHzl5Sxlk2eNNesdIv3vS4BUBVz0ohkCcUwWM8oah1U6FgZdMDuvS6iq9MErwoYS1XCJuygaqGamdrjNPkgwoCS1w4VNd4prooyrx8OQ4kUZd/ulEDmqzsq2CNyEA90Jb+NJCMTGGfXsQTSbDmMKX2E5qC3wrbf3744nagL23fyy3k0+x7YLdt/LOPEoFvPF6WMSYERPkOQinNG98057rqzLiqc00+3XIUhaG8P/2oc+EGx7EdJa6+bLiYQEacdaz23boxYxx81SMVm0E3OlPIrY0JMkwQzYRvrd56vlgB3EWFHQXjrhFsr6yCTGLEDL2e/+0RY44Z//od3khnv5DujqCdetiuNKbxBo/v2iL4TJunZh9vJw9qzgYC8z5kHSaU3nuvqYZ5AIthKUdbPN5HnUgQAxXNyLMtzntot4+E/cedQpDlZc6Xfd3shZO9gnHTdVw1YpAi99/nNnwFh5GEz4jWtuxfgyNObduOSbOtO7so4RvAmj0Kif4BlR/HPxQ== root@milano"
    live = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC/o7uyyBuox60RM8njxohbybPxPbyGlYiCkywkRgx4W1pkOTAsOfRKhzOLHLLdXgaThsr74zMRv/MIvJMejyW5k39tPn2eafo1/RfNWlgsu5kwtqnKwEh3xKI/vXvKFZSKlMev40pF6ITp6KHBYUzNPNSi8MqW9kXnbtYIUfl1WcHzl5Sxlk2eNNesdIv3vS4BUBVz0ohkCcUwWM8oah1U6FgZdMDuvS6iq9MErwoYS1XCJuygaqGamdrjNPkgwoCS1w4VNd4prooyrx8OQ4kUZd/ulEDmqzsq2CNyEA90Jb+NJCMTGGfXsQTSbDmMKX2E5qC3wrbf3744nagL23fyy3k0+x7YLdt/LOPEoFvPF6WMSYERPkOQinNG98057rqzLiqc00+3XIUhaG8P/2oc+EGx7EdJa6+bLiYQEacdaz23boxYxx81SMVm0E3OlPIrY0JMkwQzYRvrd56vlgB3EWFHQXjrhFsr6yCTGLEDL2e/+0RY44Z//od3khnv5DujqCdetiuNKbxBo/v2iL4TJunZh9vJw9qzgYC8z5kHSaU3nuvqYZ5AIthKUdbPN5HnUgQAxXNyLMtzntot4+E/cedQpDlZc6Xfd3shZO9gnHTdVw1YpAi99/nNnwFh5GEz4jWtuxfgyNObduOSbOtO7so4RvAmj0Kif4BlR/HPxQ== root@milano"
  }
}