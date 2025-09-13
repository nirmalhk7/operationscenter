#!/bin/sh

# Start or restart containers
# Dummy values for database credentials
DB_NAME="vectorchord_db"
DB_USER="vectorchord_user"
DB_PASSWORD="vectorchord_pass"

echo "Starting (or restarting) VectorChord container..."
docker compose up -d --force-recreate \
    -e POSTGRES_DB="$DB_NAME" \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD"

# Wait for container to be healthy
echo "Waiting for the database container to become healthy..."
MAX_RETRIES=20
RETRY_COUNT=0
while [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_NAME")" != "healthy" ]; do
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "Container failed to become healthy. Check logs for details."
    docker compose logs
        exit 1
    fi
    sleep 5
    RETRY_COUNT=$((RETRY_COUNT+1))
done
echo "Container is healthy!"

# Enable the extension
echo "Enabling the 'vectors' extension..."
docker compose exec db psql -U "$DB_USER" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vectors;"

echo "--- Setup Complete! ---"
echo "VectorChord is now running and ready to use."
echo "You can connect to the database with the following command:"
echo "docker compose exec db psql -U $DB_USER -d $DB_NAME"