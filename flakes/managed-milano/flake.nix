{
  description = "A flake to install Prometheus Helm chart";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    helm.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs = { self, nixpkgs, helm }: {
    packages = let
      mkPrometheusDerivation = pkgs: pkgs.stdenv.mkDerivation {
        pname = "prometheus-helm-chart";
        version = "1.0.0";
        src = ./.;
        buildInputs = [ helm ];

        buildPhase = ''
          helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
          helm repo update
          helm install prometheus prometheus-community/prometheus -f ./values.yaml
        '';
      };
    in {
      forAllSystems = system: let
        pkgs = import nixpkgs { inherit system; };
      in {
        prometheus = mkPrometheusDerivation pkgs;
      };

      x86_64-linux = self.packages.forAllSystems "x86_64-linux";
      aarch64-darwin = self.packages.forAllSystems "aarch64-darwin";
    };

    defaultPackage = {
      x86_64-linux = self.packages.x86_64-linux.prometheus;
      aarch64-darwin = self.packages.aarch64-darwin.prometheus;
    };
  };
}