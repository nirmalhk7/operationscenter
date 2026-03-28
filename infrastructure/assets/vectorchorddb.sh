#!/usr/bin/env bash
set -euo pipefail

: "${VECTORCHORD_PG_PASSWORD:?}"
: "${IMMICH_PASSWORD:?}"
: "${AUTHENTIK_PASSWORD:?}"
: "${SONARQUBE_PASSWORD:?}"
: "${OUTLINE_PASSWORD:?}"

psql_exec=(docker exec -i vectorchorddb env PGPASSWORD="${VECTORCHORD_PG_PASSWORD}" psql -U postgres)

# Verify connectivity and perform all database setup in a single psql execution
"${psql_exec[@]}" -v ON_ERROR_STOP=1 <<EOF
-- Verify connectivity
SELECT 1;

-- Immich
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname='immich') THEN CREATE DATABASE immich; END IF; END \$\$;
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='immich_rw') THEN CREATE ROLE immich_rw LOGIN PASSWORD '${IMMICH_PASSWORD}'; END IF; END \$\$;
\c immich
GRANT ALL PRIVILEGES ON DATABASE immich TO immich_rw;
GRANT ALL PRIVILEGES ON SCHEMA public TO immich_rw;
CREATE EXTENSION IF NOT EXISTS vchord CASCADE;
CREATE EXTENSION IF NOT EXISTS earthdistance CASCADE;
ALTER DATABASE immich OWNER TO immich_rw;

-- Authentik
\c postgres
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname='authentik') THEN CREATE DATABASE authentik; END IF; END \$\$;
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authentik_rw') THEN CREATE ROLE authentik_rw LOGIN PASSWORD '${AUTHENTIK_PASSWORD}'; END IF; END \$\$;
\c authentik
GRANT ALL PRIVILEGES ON DATABASE authentik TO authentik_rw;
GRANT ALL PRIVILEGES ON SCHEMA public TO authentik_rw;

-- Sonarqube
\c postgres
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname='sonarqube') THEN CREATE DATABASE sonarqube; END IF; END \$\$;
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='sonarqube_rw') THEN CREATE ROLE sonarqube_rw LOGIN PASSWORD '${SONARQUBE_PASSWORD}'; END IF; END \$\$;
\c sonarqube
GRANT ALL PRIVILEGES ON DATABASE sonarqube TO sonarqube_rw;
GRANT ALL PRIVILEGES ON SCHEMA public TO sonarqube_rw;

-- Outline
\c postgres
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname='outline') THEN CREATE DATABASE outline; END IF; END \$\$;
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='outline_rw') THEN CREATE ROLE outline_rw LOGIN PASSWORD '${OUTLINE_PASSWORD}'; END IF; END \$\$;
\c outline
GRANT ALL PRIVILEGES ON DATABASE outline TO outline_rw;
GRANT ALL PRIVILEGES ON SCHEMA public TO outline_rw;
EOF
