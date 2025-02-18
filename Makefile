
install:
	curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | \
  sh -s -- install

encrypt:
	@if [ -z "$(FILE)" ]; then \
    	echo "Usage: make encrypt-file FILE=path/to/your/file.px.yaml"; \
	else \
    	DIR=$$(dirname $(FILE)); \
		BASE=$$(basename $(FILE) .px.yaml); \
		kubeseal --format=yaml --cert=pub-sealed-secrets.pem < $(FILE) > $$DIR/$$BASE.yaml; \
	fi