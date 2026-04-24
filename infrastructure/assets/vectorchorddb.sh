#!/usr/bin/env bash
set -euo pipefail

: "${VECTORCHORD_PG_PASSWORD:?}"
: "${IMMICH_PASSWORD:?}"
: "${AUTHENTIK_PASSWORD:?}"
: "${SONARQUBE_PASSWORD:?}"
: "${OUTLINE_PASSWORD:?}"

psql_exec=(docker exec -i vectorchorddb env PGPASSWORD="${VECTORCHORD_PG_PASSWORD}" psql -U postgres)
dollar='$'

# Verify connectivity
"${psql_exec[@]}" -tAc "SELECT 1;" >/dev/null

# Immich
"${psql_exec[@]}" -tAc "DO ${dollar}${dollar} BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname='immich') THEN CREATE DATABASE immich; END IF; END ${dollar}${dollar};"
"${psql_exec[@]}" -tAc "DO ${dollar}${dollar} BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='immich_rw') THEN CREATE ROLE immich_rw LOGIN PASSWORD '${IMMICH_PASSWORD}'; END IF; END ${dollar}${dollar};"
"${psql_exec[@]}" -d immich -c "GRANT ALL PRIVILEGES ON DATABASE immich TO immich_rw;"
"${psql_exec[@]}" -d immich -c "GRANT ALL PRIVILEGES ON SCHEMA public TO immich_rw;"
"${psql_exec[@]}" -d immich -c "CREATE EXTENSION IF NOT EXISTS vchord CASCADE;"
"${psql_exec[@]}" -d immich -c "CREATE EXTENSION IF NOT EXISTS earthdistance CASCADE;"
"${psql_exec[@]}" -tAc "ALTER DATABASE immich OWNER TO immich_rw;"

# Authentik
"${psql_exec[@]}" -tAc "DO ${dollar}${dollar} BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname='authentik') THEN CREATE DATABASE authentik; END IF; END ${dollar}${dollar};"
"${psql_exec[@]}" -tAc "DO ${dollar}${dollar} BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authentik_rw') THEN CREATE ROLE authentik_rw LOGIN PASSWORD '${AUTHENTIK_PASSWORD}'; END IF; END ${dollar}${dollar};"
"${psql_exec[@]}" -d authentik -c "GRANT ALL PRIVILEGES ON DATABASE authentik TO authentik_rw;"
"${psql_exec[@]}" -d authentik -c "GRANT ALL PRIVILEGES ON SCHEMA public TO authentik_rw;"

# Sonarqube
"${psql_exec[@]}" -tAc "DO ${dollar}${dollar} BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname='sonarqube') THEN CREATE DATABASE sonarqube; END IF; END ${dollar}${dollar};"
"${psql_exec[@]}" -tAc "DO ${dollar}${dollar} BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='sonarqube_rw') THEN CREATE ROLE sonarqube_rw LOGIN PASSWORD '${SONARQUBE_PASSWORD}'; END IF; END ${dollar}${dollar};"
"${psql_exec[@]}" -d sonarqube -c "GRANT ALL PRIVILEGES ON DATABASE sonarqube TO sonarqube_rw;"
"${psql_exec[@]}" -d sonarqube -c "GRANT ALL PRIVILEGES ON SCHEMA public TO sonarqube_rw;"

# Outline
"${psql_exec[@]}" -tAc "DO ${dollar}${dollar} BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname='outline') THEN CREATE DATABASE outline; END IF; END ${dollar}${dollar};"
"${psql_exec[@]}" -tAc "DO ${dollar}${dollar} BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='outline_rw') THEN CREATE ROLE outline_rw LOGIN PASSWORD '${OUTLINE_PASSWORD}'; END IF; END ${dollar}${dollar};"
"${psql_exec[@]}" -d outline -c "GRANT ALL PRIVILEGES ON DATABASE outline TO outline_rw;"
"${psql_exec[@]}" -d outline -c "GRANT ALL PRIVILEGES ON SCHEMA public TO outline_rw;"
