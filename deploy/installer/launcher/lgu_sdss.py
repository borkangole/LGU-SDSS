r"""
LGU-SDSS desktop launcher (used by the Windows installer).

Everything the system needs is inside the install folder:
    python\      private Python 3.12 with all packages
    pgsql\       private PostgreSQL (bin, lib, share)
    backend\     Flask API  (+ serve.py)
    data\        analysis files
    frontend_dist\  built website
    db\lgu_masterdata.sql  database copy restored on the first start

The database itself lives in  %LOCALAPPDATA%\\LGU-SDSS\\pgdata  and runs on its
own port (55432), so it never clashes with another PostgreSQL on the PC.

    lgu_sdss.py            start (first start creates + loads the database)
    lgu_sdss.py --reset    delete the local database; next start reloads the copy
    lgu_sdss.py --stop     stop the database if it was left running
"""
import os
import sys
import time
import shutil
import secrets
import socket
import signal
import subprocess
import threading
import webbrowser
import urllib.request

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IS_WIN = os.name == "nt"
EXE = ".exe" if IS_WIN else ""
PGBIN = os.path.join(APP, "pgsql", "bin")
HOME = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.local/share"), "LGU-SDSS")
PGDATA = os.path.join(HOME, "pgdata")
RESTORED_FLAG = os.path.join(HOME, "database_loaded.txt")
SETTINGS = os.path.join(HOME, "settings.env")
PGLOG = os.path.join(HOME, "postgres.log")
DUMP = os.path.join(APP, "db", "lgu_masterdata.sql")
EDITION_FILE = os.path.join(APP, "db", "EDITION.txt")   # "empty" or "with-data"
DATA_DIR = os.path.join(APP, "data")
# Files the system writes when CBMS data is imported (data\ of the install
# folder). In the EMPTY edition a reset removes them too, so the system is
# really empty again; the with-data edition ships them, so they are kept.
GENERATED = ["domain_pipeline_results", "cbms 2024", "imports", "manual",
             "cbms_household_record.csv", "cbms_person_record.csv", "cbms_barangay_record.csv",
             "nlp_analytics.sqlite", "nlp_analytics.sqlite-journal"]


def edition():
    try:
        with open(EDITION_FILE, encoding="utf-8") as f:
            return f.read().strip() or "with-data"
    except OSError:
        return "with-data"
PGPORT = int(os.environ.get("LGU_PGPORT", "55432"))
DBNAME = "lgu_masterdata"
NOWIN = subprocess.CREATE_NO_WINDOW if IS_WIN else 0


def say(msg=""):
    print(msg, flush=True)


def pause(prompt="Press Enter to close ..."):
    try:
        return input(prompt)
    except EOFError:
        return ""


def read_secret(prompt, wait=None):
    """Read a key without showing it (shows * instead). On Windows, `wait` seconds
    with no key pressed returns None (so a normal start is not held up)."""
    if IS_WIN:
        import msvcrt, time
        sys.stdout.write(prompt); sys.stdout.flush()
        buf, t0 = "", time.time()
        while True:
            if not msvcrt.kbhit():
                if wait is not None and not buf and time.time() - t0 > wait:
                    sys.stdout.write("\n"); return None
                time.sleep(0.03); continue
            ch = msvcrt.getwch()
            if ch in ("\r", "\n"):
                sys.stdout.write("\n"); return buf.strip()
            if ch == "\x03":
                raise KeyboardInterrupt
            if ch in ("\x00", "\xe0"):
                msvcrt.getwch(); continue
            if ch == "\b":
                if buf:
                    buf = buf[:-1]; sys.stdout.write("\b \b"); sys.stdout.flush()
                continue
            buf += ch; wait = None
            sys.stdout.write("*"); sys.stdout.flush()
    import getpass
    try:
        return getpass.getpass(prompt).strip()
    except EOFError:
        return ""


def fail(msg):
    say()
    say("  PROBLEM: " + msg)
    say(f"  Logs are in {HOME}")
    say()
    pause()
    sys.exit(1)


def pg(tool):
    return os.path.join(PGBIN, tool + EXE)


# ── settings (random DB password, JWT secret, optional Gemini key) ─────────
def load_settings():
    s = {}
    if os.path.exists(SETTINGS):
        with open(SETTINGS, encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.rstrip("\r\n").split("=", 1)
                    s[k.strip()] = v
    return s


def save_settings(s):
    with open(SETTINGS, "w", encoding="utf-8") as f:
        f.write("# LGU-SDSS local settings (private - do not share)\n")
        for k, v in s.items():
            f.write(f"{k}={v}\n")


def pg_env(settings):
    env = dict(os.environ)
    env.update(PGPASSWORD=settings["DB_PASSWORD"], PGCLIENTENCODING="UTF8",
               PGHOST="localhost", PGPORT=str(PGPORT), PGUSER="postgres")
    return env


def run(cmd, env=None, log=None, check=True, timeout=900):
    """Run a tool and return (ok, output).

    Output always goes to a FILE, never a pipe: on Windows, a database process
    started by a tool inherits its output handles, and reading a pipe would
    then wait forever (the old "stuck at Starting the database" problem).
    """
    import tempfile
    if log:
        out_path, keep = log, True
    else:
        fd, out_path = tempfile.mkstemp(prefix="lgu_", suffix=".log", dir=HOME)
        os.close(fd)
        keep = False
    try:
        with open(out_path, "a", encoding="utf-8", errors="replace") as out:
            try:
                r = subprocess.run(cmd, env=env, stdout=out, stderr=subprocess.STDOUT,
                                   stdin=subprocess.DEVNULL, creationflags=NOWIN, timeout=timeout)
                code = r.returncode
            except subprocess.TimeoutExpired:
                out.write(f"\n[timed out after {timeout} s]\n")
                code = -1
        text = ""
        if not keep:
            with open(out_path, encoding="utf-8", errors="replace") as f:
                text = f.read()
        return code == 0, text
    finally:
        if not keep:
            try:
                os.remove(out_path)
            except OSError:
                pass


# ── PostgreSQL ──────────────────────────────────────────────────────────────
def pg_running(env):
    ok, _ = run([pg("pg_ctl"), "-D", PGDATA, "status"], env=env, check=False, timeout=60)
    return ok


def pg_start(env):
    if pg_running(env):
        return
    say("Starting the database ...")
    # CREATE_NO_WINDOW: the database runs in its own hidden console, so it is
    # shut down cleanly by pg_stop() instead of being killed with this window.
    # Output goes to a file, never a pipe: on Windows the database process
    # inherits pg_ctl's output handles, so waiting on a pipe would never end.
    ok, _ = run([pg("pg_ctl"), "-D", PGDATA, "-l", PGLOG, "-w", "-t", "120",
                 "-o", f"-p {PGPORT} -c listen_addresses=localhost", "start"],
                env=env, log=os.path.join(HOME, "pg_ctl.log"), timeout=180)
    if not ok and not pg_running(env):
        fail("The database did not start. See postgres.log.")


def pg_stop(env):
    if os.path.exists(os.path.join(PGDATA, "postmaster.pid")):
        run([pg("pg_ctl"), "-D", PGDATA, "-m", "fast", "-w", "-t", "30", "stop"], env=env,
            log=os.path.join(HOME, "pg_ctl.log"), check=False, timeout=60)


def first_time_setup(settings):
    """Create the private database cluster and load the database copy."""
    env = pg_env(settings)
    if not os.path.exists(os.path.join(PGDATA, "PG_VERSION")):
        if os.path.isdir(PGDATA):
            shutil.rmtree(PGDATA, ignore_errors=True)
        if os.path.exists(RESTORED_FLAG):
            os.remove(RESTORED_FLAG)
        say("First start: creating the database (one time) ...")
        pwfile = os.path.join(HOME, "pw.tmp")
        with open(pwfile, "w", encoding="utf-8") as f:
            f.write(settings["DB_PASSWORD"] + "\n")
        try:
            ok, out = run([pg("initdb"), "-D", PGDATA, "-U", "postgres", "-A", "scram-sha-256",
                           f"--pwfile={pwfile}", "-E", "UTF8", "--no-locale"], env=env)
        finally:
            os.remove(pwfile)
        if not ok:
            with open(os.path.join(HOME, "initdb.log"), "w", encoding="utf-8") as f:
                f.write(out)
            shutil.rmtree(PGDATA, ignore_errors=True)
            fail("Could not create the database (see initdb.log).")

    pg_start(env)

    if not os.path.exists(RESTORED_FLAG):
        if not os.path.exists(DUMP):
            fail("The database copy (db\\lgu_masterdata.sql) is missing from the installation.")
        say("Setting up the LGU-SDSS database (one time) ..." if edition() == "empty"
            else "Loading the LGU-SDSS data (one time, about 1-2 minutes) ...")
        psql = pg("psql")
        run([psql, "-d", "postgres", "-q", "-c", f"DROP DATABASE IF EXISTS {DBNAME}"], env=env, check=False)
        ok, out = run([psql, "-d", "postgres", "-q", "-c",
                       f"CREATE DATABASE {DBNAME} ENCODING 'UTF8' TEMPLATE template0"], env=env)
        if not ok:
            fail("Could not create the database: " + out.strip())
        log = os.path.join(HOME, "restore.log")
        if os.path.exists(log):
            os.remove(log)
        ok, _ = run([psql, "-d", DBNAME, "-q", "-v", "ON_ERROR_STOP=1", "-f", DUMP], env=env, log=log, timeout=3600)
        if not ok:
            run([psql, "-d", "postgres", "-q", "-c", f"DROP DATABASE IF EXISTS {DBNAME}"], env=env, check=False)
            fail("Loading the data failed (see restore.log). Close this window and try again.")
        ok, out = run([psql, "-d", DBNAME, "-tAc", "select count(*) from tbl_households"], env=env, check=False)
        with open(RESTORED_FLAG, "w", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S") + "\n")
        n = out.strip()
        if edition() == "empty" or n == "0":
            say("  Done: the database is ready and EMPTY (no households yet).")
            say("  Sign in, then import the CBMS files: Households > Import CBMS files.")
        else:
            say(f"  Done: {n} households loaded.")


# ── web server ──────────────────────────────────────────────────────────────
def free_port(preferred=(8080, 8090, 8181, 8282, 8383)):
    for p in preferred:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def already_running():
    s = load_settings()
    p = s.get("LAST_PORT")
    if not p:
        return None
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{p}/api/health", timeout=2)
        return int(p)
    except Exception:
        return None


def open_when_ready(url):
    for _ in range(120):
        try:
            urllib.request.urlopen(url + "/api/health", timeout=2)
            webbrowser.open(url)
            return
        except Exception:
            time.sleep(1)


def install_close_handler(env):
    """Stop the database cleanly when this window is closed."""
    if not IS_WIN:
        return None
    import ctypes
    from ctypes import wintypes

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)
    def handler(event):
        pg_stop(env)
        return False  # let Windows continue closing / Ctrl+C continue

    ctypes.windll.kernel32.SetConsoleCtrlHandler(handler, True)
    return handler  # keep a reference so it is not garbage-collected


def main():
    os.makedirs(HOME, exist_ok=True)
    if IS_WIN:
        os.system("title LGU-SDSS")
    say("============================================================")
    say("  LGU-SDSS  -  San Miguel, Iloilo")
    say("  Keep this window open while you use the system.")
    say("  Close it to stop the system.")
    say("============================================================")

    settings = load_settings()
    changed = False
    if not settings.get("DB_PASSWORD"):
        settings["DB_PASSWORD"] = secrets.token_hex(16)
        changed = True
    if not settings.get("JWT_SECRET_KEY"):
        settings["JWT_SECRET_KEY"] = secrets.token_hex(32)
        changed = True
    args = sys.argv[1:]
    if not args:
        key = settings.get("GEMINI_API_KEY", "")
        say()
        if not key:
            first_time = "GEMINI_API_KEY" not in settings
            say("Optional: paste a Gemini API key for the AI part of 'Ask the Data'.")
            say("(It can also be added or changed later inside the system: Account Settings > AI / Gemini key.)")
            if first_time:
                say("(Everything else works without it. Press Enter to skip. The key is hidden as you type.)")
                new = read_secret("Gemini API key: ")
            else:
                say("(No key saved. Everything else works without it. The key is hidden as you type.)")
                new = read_secret("Gemini API key (or wait 6 seconds to skip): ", wait=6)
            if first_time or new:
                settings["GEMINI_API_KEY"] = new or ""
                changed = True
            if new:
                say("  Saved for next time (to replace it later, paste a new one when asked).")
        else:
            say(f"Gemini API key saved (ends with ...{key[-4:]}).")
            say("To use a different key, paste it now (hidden). To remove it, type: remove")
            new = read_secret("New key (or wait 6 seconds to keep): ", wait=6)
            if new:
                if new.lower() == "remove":
                    settings["GEMINI_API_KEY"] = ""
                    say("  Key removed.")
                else:
                    settings["GEMINI_API_KEY"] = new
                    say("  Key replaced and saved.")
                changed = True
            else:
                say("  Keeping the saved key.")
    if changed:
        save_settings(settings)

    env = pg_env(settings)
    if "--stop" in args:
        pg_stop(env)
        say("Stopped.")
        return
    if "--reset" in args:
        say("This deletes the database on this PC (households added or imported here will be lost).")
        if pause("Type YES to continue: ").strip() != "YES":
            say("Cancelled.")
            return
        pg_stop(env)
        shutil.rmtree(PGDATA, ignore_errors=True)
        if os.path.exists(RESTORED_FLAG):
            os.remove(RESTORED_FLAG)
        if edition() == "empty":
            for name in GENERATED:
                p = os.path.join(DATA_DIR, name)
                if os.path.isdir(p):
                    shutil.rmtree(p, ignore_errors=True)
                elif os.path.exists(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass
            say("Done. The next start begins with an EMPTY system; import the CBMS files again.")
        else:
            say("Done. The next start loads the original data again.")
        pause()
        return

    port = already_running()
    if port:
        say("LGU-SDSS is already running - opening it in the browser.")
        webbrowser.open(f"http://localhost:{port}")
        time.sleep(2)
        return

    first_time_setup(settings)
    pg_start(env)
    handler = install_close_handler(env)  # noqa: F841

    port = free_port()
    settings["LAST_PORT"] = str(port)
    save_settings(settings)

    backend = os.path.join(APP, "backend")
    os.environ.update(
        DB_HOST="localhost", DB_PORT=str(PGPORT), DB_NAME=DBNAME, DB_USER="postgres",
        DB_PASSWORD=settings["DB_PASSWORD"], JWT_SECRET_KEY=settings["JWT_SECRET_KEY"],
        GEMINI_API_KEY=settings.get("GEMINI_API_KEY", ""),
        FRONTEND_DIST=os.path.join(APP, "frontend_dist"),
        MPLBACKEND="Agg", PYTHONIOENCODING="utf-8",
        MPLCONFIGDIR=os.path.join(HOME, "matplotlib"),
        PYTHONNOUSERSITE="1",  # the recalculation scripts must not pick up another Python's packages
    )
    for k in ("PYTHONPATH", "PYTHONHOME"):
        os.environ.pop(k, None)
    if settings.get("GEMINI_MODEL"):
        os.environ["GEMINI_MODEL"] = settings["GEMINI_MODEL"]
    os.chdir(backend)
    sys.path.insert(0, backend)

    say()
    say("Starting the system ...")
    try:
        from serve import app  # backend/serve.py: API + website on one address
        from waitress import serve
    except Exception as e:
        import traceback
        with open(os.path.join(HOME, "app_error.log"), "w", encoding="utf-8") as f:
            traceback.print_exc(file=f)
        pg_stop(env)
        fail(f"The system could not start: {e}")

    def _interrupt(signum, frame):
        raise KeyboardInterrupt
    for sig in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, sig):
            signal.signal(getattr(signal, sig), _interrupt)

    url = f"http://localhost:{port}"
    threading.Thread(target=open_when_ready, args=(url,), daemon=True).start()
    say(f"LGU-SDSS is running at  {url}")
    say("(The browser opens by itself. You can close the browser and open this address again.)")
    say()
    try:
        serve(app, host="127.0.0.1", port=port, threads=8)
    except KeyboardInterrupt:
        pass
    finally:
        say("Stopping ...")
        pg_stop(env)


if __name__ == "__main__":
    main()
