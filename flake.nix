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
    packages = let
      createPackage = system: let
        pkgs = import nixpkgs { inherit system; };
      in pkgs.stdenv.mkDerivation {
        name = "operationscenter-milano";
        src = ./.;
        buildInputs = [ pkgs.hello ];
        installPhase = ''
          mkdir -p $out/bin
          echo '#!/bin/sh' > $out/bin/operationscenter-milano
          echo 'echo Hello, World!' >> $out/bin/operationscenter-milano
          chmod +x $out/bin/operationscenter-milano
        '';
      };
    in {
      x86_64-linux = createPackage "x86_64-linux";
      aarch64-darwin = createPackage "aarch64-darwin";
    };

    defaultPackage = {
      x86_64-linux = self.packages.x86_64-linux;
      aarch64-darwin = self.packages.aarch64-darwin;
    };

    devShells = let
      pkgs = import nixpkgs { inherit (self) system; };
    in {
      default = pkgs.mkShell {
        buildInputs = [
          self.packages.${builtins.currentSystem}
          k3d.defaultPackage.${builtins.currentSystem}
        ];
      };
    };
  };
}