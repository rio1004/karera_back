#!/bin/bash

# Define the directory where the SQL files are located.
SQL_DIR="/docker-entrypoint-sql"

# Check if the directory exists and is readable.
if [ -d "$SQL_DIR" ]; then
  # Loop through all files in the specified directory that end with .sql,
  # ensuring they are processed in alphabetical order.
  for file in $(ls "$SQL_DIR"/*.sql | sort); do
    echo "Executing SQL file: $file"
    psql -d template1 -f "$file"
  done
else
  echo "Error: The directory $SQL_DIR does not exist or is not a directory."
fi