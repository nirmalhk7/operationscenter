# Makefile for operationscenter

.PHONY: encrypt reencrypt backup nginx-build nginx-logs encrypt_newkey terraform-reset terraform-apply init onboard-agents-discord sync kubernetes-init kubernetes-clean ansible-run ansible-run-one

# --- Initialization ---
init:
	@./install.sh
	@echo "=== Part 1: Terraform ==="
	$(MAKE) terraform-apply
	@echo "=== Part 2: Ansible ==="
	$(MAKE) ansible-run
	@echo "=== Part 3: Kubernetes ==="
	$(MAKE) kubernetes-init
	@echo "=== Part 4: Docker & Nginx ==="
	$(MAKE) nginx-build
	@echo "=== Initialization Complete ==="

# --- Sealed Secrets ---
encrypt:
	@if [ -z "$(FILE)" ]; then \
		echo "Usage: make encrypt FILE=path/to/your/file.px.yaml"; \
	else \
		DIR=$$(dirname $(FILE)); \
		BASE=$$(basename $(FILE) .px.yaml); \
		kubeseal --format=yaml --cert=pub-sealed-secrets.pem < $(FILE) > $$DIR/$$BASE.yaml; \
	fi

encrypt_all:
	@echo "Reencrypting all .px.yaml files in clusters directory..."
	kubeseal --fetch-cert > pub-sealed-secrets.pem
	@find clusters -type f -name "*.px.yaml" -exec echo "Processing {}" \; -exec $(MAKE) encrypt FILE={} \;
	@echo "Reencryption complete."

encrypt_newkey:
	kubeseal --fetch-cert --controller-name=sealed-secrets-controller --controller-namespace=flux-system > pub-sealed-secrets.pem

# --- Backup ---
backup_nginx:
	mkdir -p nginx.bkp
	rsync -a nginx/ nginx.bkp/
	(cd nginx.bkp && zip -r ../nginx.bkp.zip .)
	rm -rf nginx.bkp

backup_repo:
	mkdir -p repo.bkp
	cp .env repo.bkp/ || true
	rsync -a --exclude='repo.bkp' --exclude='repo.bkp.zip' ./ repo.bkp/
	zip -r repo.bkp.zip repo.bkp
	rm -rf repo.bkp

# --- Nginx ---
nginx-build:
	cp -r ~/operationscenter/nginx/* /etc/nginx/
	rc-service nginx restart

nginx-logs:
	tail -f /var/log/nginx/error.log /var/log/nginx/access.log

# --- Terraform ---
terraform-clear:
	cd infrastructure/terra && rm -rf .terraform .terraform.lock.hcl terraform.tfstate .terraform.tfstate.backup terraform.tfstate.backup && \
	terraform init -upgrade && \
	terraform import proxmox_virtual_environment_network_linux_bridge.wmnet milano:wmnet && \
	terraform import proxmox_virtual_environment_group.ug-mgd ug-mgd && \
	terraform import proxmox_virtual_environment_group.ug-dev ug-dev && \
	terraform import proxmox_virtual_environment_group.ug-bots ug-bots && \
	terraform import proxmox_virtual_environment_cluster_firewall_security_group.sg-dev sg-dev && \
	terraform import proxmox_virtual_environment_cluster_firewall_security_group.sg-managed sg-managed && \
	terraform import proxmox_virtual_environment_pool.pool-dev pool-dev && \
	terraform import proxmox_virtual_environment_pool.pool-mgd pool-mgd

terraform-reset:
	cd infrastructure/terra && terraform state rm proxmox_lxc.testlxc || true
	cd infrastructure/terra && terraform destroy -auto-approve

terraform-apply:
	cd infrastructure/terra && terraform init -upgrade && terraform plan && terraform apply -auto-approve

# --- Ansible ---
ansible-install:
	@if command -v ansible >/dev/null 2>&1; then \
	  echo "Ansible already installed."; \
	else \
	  pip install --user ansible; \
	fi

ansible-run: ansible-install
	@eval "$$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519_homelab && \
	cd infrastructure/ansible && \
	if [ -f .env ]; then \
		set -a; . .env; set +a; \
	fi; \
	echo "Running Mainbook #########################################"; \
	ansible-playbook -i inventory.ini main.ansible.yaml --skip-tags disabled,upgrade; \


ansible-run-one: ansible-install
	@if [ -z "$(NOTEBOOK)" ]; then \
		echo "Usage: make ansible-run-one NOTEBOOK=path/to/playbook.ansible.yaml"; \
	else \
		eval "$$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519_homelab && \
		cd infrastructure/ansible && \
		if [ -f .env ]; then \
			set -a; . .env; set +a; \
		fi; \
		ansible-playbook  -i inventory.ini "$(NOTEBOOK)" --skip-tags disabled,upgrade; \
	fi

# --- Kubernetes ---
kubernetes-init:
	@echo "Applying MariaDB Operator CRDs..."
	kubectl apply -f https://github.com/mariadb-operator/mariadb-operator/releases/download/mariadb-operator-crds-25.8.3/crds.yaml
	@echo "Installing FluxCD..."
	kubectl apply -f https://github.com/fluxcd/flux2/releases/latest/download/install.yaml
	@echo "Applying managed cluster manifests..."
	kubectl apply -k ./clusters/managed


kubernetes-clean:
	kubectl delete -k clusters/managed || true
	for ns in $(kubectl get ns --no-headers | awk '{print $$1}' | grep -vE 'kube-system|kube-public|kube-node-lease'); do \
	  echo "Force deleting namespace: $$ns"; \
	  kubectl get namespace $$ns -o json | jq 'del(.spec.finalizers)' | kubectl replace --raw "/api/v1/namespaces/$$ns/finalize" -f -; \
	done


# --- Discord ---
onboard-agents-discord:
	@if [ -z "$(CLIENT_IDS)" ]; then \
		echo "Usage: make onboard-agents CLIENT_IDS=\"id1 id2 id3\""; \
	else \
		for id in $(CLIENT_IDS); do \
			echo "Onboarding agent with Client ID: $$id"; \
			open "https://discord.com/oauth2/authorize?client_id=$$id&permissions=0&integration_type=0&scope=bot"; \
			sleep 10; \
		done; \
	fi

# --- Flux ---
flux-suspend:
	@if [ -z "$(NS)" ]; then \
		echo "Usage: make flux-suspend NS=namespace (e.g., default, monitoring)"; \
	else \
		flux suspend kustomization mgd-$(NS); \
	fi

flux-resume:
	@if [ -z "$(NS)" ]; then \
		echo "Usage: make flux-resume NS=namespace"; \
	else \
		flux resume kustomization mgd-$(NS); \
	fi

sync:
	git add .
	git commit --amend --no-edit
	git push --force