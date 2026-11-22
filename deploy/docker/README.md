# LGU-SDSS — running it on another PC with Docker

Everything (database + backend + website) runs in Docker. People open **one address**
in a browser — nobody runs `npm run dev` or `python app.py`.

## On YOUR PC — make the package (1 click)
1. Make sure PostgreSQL is running and the system works on your PC.
2. Double-click **`deploy\make_package.bat`** and type your PostgreSQL password.
   - it copies the database into `deploy\initdb\lgu_masterdata.sql`
     and notes its PostgreSQL version in `deploy\pg_version.txt`
   - it zips the system to **`LGU-SDSS-package.zip` in the Thesis System folder**, without
     `node_modules`, build folders, caches, the `CDRA` PDFs and your `.env` files
3. Send the zip privately (USB / private Drive link). It contains real CBMS household
   data and your login accounts. Your passwords and Gemini key are **not** in it.

## On the OTHER PC — see `START-HERE.txt`
1. Install Docker Desktop, open it, wait for **Engine running**.
2. Unzip to e.g. `C:\LGU-SDSS` (not inside OneDrive/Downloads).
3. Double-click **`start.bat`** → first time 5–15 min (needs internet) → the browser opens
   **http://localhost:8080**. Log in with the same accounts as on your PC.

Other PCs on the same network: `http://<that-PC's-name-or-IP>:8080`
(allow port 8080 if Windows Firewall asks).

## Files
| File | What it does |
|---|---|
| `start.bat` | first run: creates `.env` (random passwords, optional Gemini key); builds and starts; opens the browser |
| `stop.bat` | stops the system (data is kept) |
| `logs.bat` | shows the system's messages |
| `backup_db.bat` | saves the Docker database to `backups\` |
| `reset_database.bat` | deletes the Docker database and restores it from `deploy\initdb\` |
| `make_package.bat` | (your PC) database copy + zip |
| `Dockerfile`, `docker-compose.yml`, `deploy\serve.py`, `requirements-docker.txt` | the Docker setup |

## Good to know
- **Internet** is needed for the first build, for Ask the Data's AI (Gemini) and for the map tiles.
- The `data` folder is shared with the container: CBMS imports, recalculated scores and
  hand-added households are saved there and survive restarts.
- The database is restored from `deploy\initdb\*.sql` **only the first time**. To load a newer
  copy, replace the file and run `reset_database.bat` (this deletes the Docker database).
- Updating the code: copy the new files over and run `start.bat` again (it rebuilds).
- Port 8080 in use? Change `APP_PORT` in `.env`.
