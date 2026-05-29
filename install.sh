#!/bin/bash
set -e

echo "=== Verifying Installations ==="
for cmd in terraform ansible kubectl kubeseal jq curl; do
	if ! command -v $cmd >/dev/null 2>&1; then
		echo "Error: $cmd is not installed."
		exit 1
	fi
done
echo "All required tools are installed."

echo "=== Verifying SSH Setup ==="
if [ ! -d ~/.ssh ]; then
    echo "Creating ~/.ssh directory..."
    mkdir -p ~/.ssh
    chmod 700 ~/.ssh
fi

if [ ! -f ~/.ssh/id_ed25519_homelab ]; then
	echo "SSH key ~/.ssh/id_ed25519_homelab not found."
    printf "Generate it now? (y/n): "
    read gen_key
    if [ "$gen_key" = "y" ]; then
        ssh-keygen -t ed25519 -C "homelab" -f ~/.ssh/id_ed25519_homelab -N ""
        echo "Successfully generated ~/.ssh/id_ed25519_homelab"
    else
        echo "Please generate it or copy it over before proceeding."
	    exit 1
    fi
else
    echo "SSH key ~/.ssh/id_ed25519_homelab found."
fi

if [ ! -f ~/.ssh/id_ed25519_mgmt ]; then
	echo "SSH key ~/.ssh/id_ed25519_mgmt not found. (Required for management/Terraform)"
    printf "Generate it now? (y/n): "
    read gen_key_mgmt
    if [ "$gen_key_mgmt" = "y" ]; then
        ssh-keygen -t ed25519 -C "mgmt" -f ~/.ssh/id_ed25519_mgmt -N ""
        echo "Successfully generated ~/.ssh/id_ed25519_mgmt"
    else
        echo "Please generate it or copy it over before proceeding."
	    exit 1
    fi
else
    echo "SSH key ~/.ssh/id_ed25519_mgmt found."
fi

echo "=== Verifying Kubernetes Config Setup ==="
if [ ! -d ~/.kube ]; then
    echo "Creating ~/.kube directory..."
    mkdir -p ~/.kube
    chmod 700 ~/.kube
fi

if [ ! -f ~/.kube/config ]; then
    echo "Warning: Kubernetes config (~/.kube/config) not found."
    echo "Make sure to place your kubeconfig here if you interact with an external cluster."
else
    echo "Kubernetes config found."
fi

echo "=== Verifying Ansible Config ==="
if [ ! -f infrastructure/ansible/.env ]; then
    echo "Warning: infrastructure/ansible/.env not found."
    echo "Ansible playbooks might require environment variables defined here."
else
    echo "Ansible .env found."
fi

echo "=== Verifying Sealed Secrets ==="
if [ ! -f pub-sealed-secrets.pem ]; then
    echo "Warning: pub-sealed-secrets.pem not found in the root repository."
    echo "You may need to run 'make encrypt_newkey' later if setting up SealedSecrets for the first time."
else
    echo "SealedSecrets certificate found."
fi

echo "=== User Input ==="
printf "Are you sure you want to initialize the infrastructure? (y/n): "
read confirm
echo "You entered: $confirm"
if [ "$confirm" != "y" ]; then
	echo "Initialization aborted."
	exit 1
fi
echo "Starting initialization..."
