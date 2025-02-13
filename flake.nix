{
  description = "We go big or go home. Operations Center Mainflake";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    k3d = {
      url = "./flakes/k3d";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, k3d }: {
    packages = {
      x86_64-linux = let
        pkgs = import nixpkgs { system = "x86_64-linux"; };
      in {
        operationsCenterMilano = pkgs.stdenv.mkDerivation {
          name = "operationscenter-milano";
          src = ./.;
          buildInputs = [ pkgs.hello ];
        };
      };

      aarch64-darwin = let
        pkgs = import nixpkgs { system = "aarch64-darwin"; };
      in {
        operationsCenterMilano = pkgs.stdenv.mkDerivation {
          name = "operationscenter-milano";
          src = ./.;
          buildInputs = [ pkgs.hello ];
        };
      };
    };

    defaultPackage = {
      x86_64-linux = self.packages.x86_64-linux.operationsCenterMilano;
      aarch64-darwin = self.packages.aarch64-darwin.operationsCenterMilano;
    };
  };
}