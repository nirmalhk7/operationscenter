{
  description = "A flake to install k3d and create clusters";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs = { self, nixpkgs }: {
    forAllSystems = f: {
      x86_64-linux = f "x86_64-linux";
      aarch64-darwin = f "aarch64-darwin";
      # Add other architectures as needed
    };

    packages = self.forAllSystems (system: {
      defaultPackage = nixpkgs.legacyPackages.${system}.k3d;
    });

    defaultPackage = self.forAllSystems (system: self.packages.${system}.defaultPackage);

    devShell = self.forAllSystems (system: with nixpkgs.legacyPackages.${system}; mkShell {
      # No need to include k3d in buildInputs since it's already in your PATH
      buildInputs = [];

      shellHook = ''
        # Ensure k3d is available in PATH
        if ! command -v k3d &> /dev/null; then
          echo "k3d could not be found in your PATH. Please ensure it is installed and available."
          exit 1
        fi

        # Create clusters
        echo "dev cluster: playground"
        k3d cluster create milano-dev --k3s-arg "--tls-san 'trusted.nirmalhk7.com' --tls-san 'milano'"
        echo "managed cluster: critical applications"
        k3d cluster create milano-managed --servers 2 --agents 2  --k3s-arg "--tls-san 'trusted.nirmalhk7.com' --tls-san 'milano'"
        echo "live cluster: internet exposed"
        k3d cluster create milano-live  --k3s-arg "--tls-san 'trusted.nirmalhk7.com' --tls-san 'milano'"

        # Print client-certificate-data, client-key-data, and certificate-authority-data
        for cluster in milano-dev milano-managed milano-live; do
          echo "Cluster: $cluster"
          kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$cluster\")].cluster.certificate-authority-data}"
          echo
          kubectl config view --raw -o jsonpath="{.users[?(@.name==\"$cluster\")].user.client-certificate-data}"
          echo
          kubectl config view --raw -o jsonpath="{.users[?(@.name==\"$cluster\")].user.client-key-data}"
          echo
        done
      '';
    });
  };
}