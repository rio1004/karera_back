# Karera backend: local setup without Docker

Use Node.js 22.12+ or 24 LTS, PostgreSQL, and Redis. The API runs directly on
Windows with Node.js. PostgreSQL and Redis are required services; Docker is optional.

## One-time setup

1. Install PostgreSQL locally and keep its Windows service running. PostgreSQL 18
   is already installed on this machine. Use pgAdmin or SQL Shell to create the
   `karera` database if it does not exist:

   ```sql
   CREATE DATABASE karera;
   ```

2. Install Redis in Ubuntu under WSL, following
   [Microsoft's Redis on WSL instructions](https://learn.microsoft.com/en-us/windows/wsl/tutorials/wsl-database#redis).
   If Ubuntu is not installed, run `wsl --install -d Ubuntu` in an administrator
   PowerShell and finish Ubuntu setup (restart Windows if requested). In Ubuntu:

   ```bash
   sudo apt update
   sudo apt install redis-server
   sudo service redis-server start
   redis-cli ping
   ```

   The last command should return `PONG`. From Windows, Redis must be reachable
   on `127.0.0.1:6379`.

3. In PowerShell:

   ```powershell
   cd C:\Users\Rio\Documents\node_projects\karera_back
   npm install
   Copy-Item .env.sample .env
   ```

   Skip the copy if `.env` exists. Edit `.env` so `DATABASE_PASS` matches the
   password chosen during PostgreSQL installation. The other local values are:

   ```dotenv
   HOST=127.0.0.1
   PORT=8000
   DATABASE_HOST=127.0.0.1
   DATABASE_PORT=5432
   DATABASE_USER=postgres
   DATABASE_NAME=karera
   DATABASE_SSL=false
   REDIS_HOST=127.0.0.1
   REDIS_PORT=6379
   ```

4. Initialize your local development database:

   ```powershell
   npm run db:setup
   ```

   This runs migrations and creates the existing test users, studios, and game
   session data. Use it only for a development database. On later schema updates,
   use `npm run db:migrate`. Starting the API does not migrate or seed automatically.

5. Set up the frontend once:

   ```powershell
   cd C:\Users\Rio\Documents\node_projects\karera_front
   npm install
   Copy-Item .env.sample .env
   ```

   Skip the copy if `.env` exists. Its `VITE_API_HOST` should be `127.0.0.1`,
   `VITE_API_PORT` should be `8000`, and `VITE_WS_URL` should be
   `ws://127.0.0.1:8000/api/studio/DL01`.

## Run both apps

Keep PostgreSQL running. Start Redis in Ubuntu with `sudo service redis-server start`.
Open two PowerShell terminals and leave both running.

Backend terminal:

```powershell
cd C:\Users\Rio\Documents\node_projects\karera_back
npm run dev
```

Frontend terminal:

```powershell
cd C:\Users\Rio\Documents\node_projects\karera_front
npm run dev
```

Open http://localhost:3000. The API health endpoint is
http://127.0.0.1:8000/health and API documentation is http://127.0.0.1:8000/docs.
Stop each app with Ctrl+C. `npm start` runs the backend without the file watcher.

The separate archive API (port 8001) and game site (port 3001) are not supplied
by this backend. Pages using them require those services to run separately.
SMS, verification, and payment integrations require their respective configuration.

## Build

```powershell
npm run build
npm run serve
```

The compiled server also uses `.env` and respects `DATABASE_SSL`.

## Troubleshooting

- PostgreSQL connection refused: start its Windows service and confirm port 5432.
- Password authentication failed: correct `DATABASE_USER` and `DATABASE_PASS` in `.env`.
- Database does not exist: create `karera` in PostgreSQL before migrating.
- Missing tables: run `npm run db:migrate` against the intended local database.
- Redis connection refused: start Redis in WSL and check `redis-cli ping`.
- Port already in use: stop the previous server or update `PORT` and the frontend API settings together.
