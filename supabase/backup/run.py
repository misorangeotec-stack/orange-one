#!/usr/bin/env python3
"""
Orange One — the nightly backup to Google Drive (PF-16).

Run by .github/workflows/backup.yml, woken by pg_cron (public.backup_kick).
Standard library only, so the runner needs nothing but python3, pg_dump 17,
age and rclone.

WHAT ONE RUN DOES
  1. Asks the database whether to go (backup_run_start). A scheduled run that
     is not due exits here, successfully, having touched nothing.
  2. FILES — copies every uploaded document not yet backed up into
       Orange One Hub/Files/<Module>/<Step>/<YYYY-MM>/<Record>/<file>
     in batches: plan -> download from Supabase Storage -> upload to Drive ->
     check each landed -> record it (backup_files_done). A file that fails is
     simply offered again next night. Files are NEVER deleted from the backup.
  3. DATABASES — a complete compressed pg_dump of Orange One every night, and of
     Tally (ConnectWave) when the database says so (Sundays), each encrypted
     with age before it leaves the runner, uploaded, and its md5 checked.
  4. RETENTION — only after tonight's dump is verified: keep the newest N dumps
     of that database (7 / 4), delete the rest permanently (not to Drive's bin,
     which would still count against the space for 30 days).
  5. Uploads "Files index.csv", "HOW TO RESTORE.txt" and a plain-words run log,
     then reports back (backup_run_finish). The watchdog emails if no success.

MODES
  dry-run    connects to everything and copies nothing (schema-only dumps to
             nowhere, the file plan counted, Drive's space read). The default.
  scheduled  the nightly run.
  full       everything now: all new files and BOTH databases.

⚠ The live databases are only ever READ: both database logins are read-only
  roles (default_transaction_read_only, pg_read_all_data), and the storage key
  is only used as a copy SOURCE. Nothing here writes to either project except
  the backup's own run log and file log, through the functions above.
"""

import datetime as dt
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
MODE = (os.environ.get("MODE") or "dry-run").strip()
WORK = pathlib.Path(os.environ.get("WORK_DIR") or "backup-work").resolve()
RCLONE = os.environ.get("RCLONE_BIN") or "rclone"
PG_DUMP = os.environ.get("PG_DUMP_BIN") or "pg_dump"
AGE = os.environ.get("AGE_BIN") or "age"
HERE = pathlib.Path(__file__).resolve().parent

APP_ROOT = "Orange One Hub"
TALLY_ROOT = "Tally (ConnectWave)"
BATCH = int(os.environ.get("FILE_BATCH") or "400")

# What goes into each database copy. auth = the logins (without it nobody can
# sign in and every created_by points nowhere); storage = the file records;
# cron = the schedules. job_run_details is history, not state, and can be large.
DB_SCHEMAS = ["public", "private", "auth", "storage", "cron", "supabase_migrations"]


def env(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        raise SystemExit(f"missing environment variable {name}")
    return v


def now_ist() -> dt.datetime:
    return dt.datetime.now(IST)


def human(n) -> str:
    n = float(n or 0)
    for unit in ("bytes", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "bytes" else f"{n:.1f} {unit}"
        n /= 1024


def log(msg: str) -> None:
    print(f"[{now_ist():%H:%M:%S}] {msg}", flush=True)


# ------------------------------------------------------------------ database --

def rpc(fn: str, args: dict | None = None, timeout: int = 180):
    url = env("SUPABASE_URL").rstrip("/") + f"/rest/v1/rpc/{fn}"
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    body = json.dumps(args or {}).encode()
    last = None
    for attempt in range(4):
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "apikey": key, "Authorization": f"Bearer {key}",
            "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:500]
            if e.code < 500:
                raise RuntimeError(f"{fn}: HTTP {e.code} {detail}") from None
            last = f"HTTP {e.code} {detail}"
        except (urllib.error.URLError, TimeoutError) as e:
            last = str(e)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"{fn}: gave up after retries: {last}")


# -------------------------------------------------------------------- rclone --

def write_rclone_config() -> pathlib.Path:
    """Built from secrets at run time; never printed, removed at the end."""
    token = env("GDRIVE_TOKEN")
    json.loads(token)  # fail early and clearly if the secret is not the token JSON
    conf = WORK / "rclone.conf"
    conf.write_text(
        "[gdrive]\n"
        "type = drive\n"
        f"client_id = {env('GDRIVE_CLIENT_ID')}\n"
        f"client_secret = {env('GDRIVE_CLIENT_SECRET')}\n"
        "scope = drive.file\n"
        f"token = {token}\n"
        f"root_folder_id = {env('GDRIVE_ROOT_FOLDER_ID')}\n"
        "\n"
        "[supa]\n"
        "type = s3\n"
        "provider = Other\n"
        f"endpoint = {env('S3_ENDPOINT')}\n"
        f"region = {env('S3_REGION')}\n"
        f"access_key_id = {env('S3_ACCESS_KEY_ID')}\n"
        f"secret_access_key = {env('S3_SECRET_ACCESS_KEY')}\n"
        "force_path_style = true\n",
        encoding="utf-8")
    try:
        conf.chmod(0o600)
    except OSError:
        pass
    os.environ["RCLONE_CONFIG"] = str(conf)
    return conf


def rclone(*args: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    cmd = [RCLONE, *args]
    r = subprocess.run(cmd, text=True, encoding="utf-8", errors="replace",
                       capture_output=capture)
    if check and r.returncode != 0:
        tail = (r.stderr or "")[-800:] if capture else ""
        raise RuntimeError(f"rclone {args[0]} failed (exit {r.returncode}) {tail}")
    return r


def drive(path: str) -> str:
    return "gdrive:" + path


# --------------------------------------------------------------------- files --

def backup_files(run_id: int, stats: dict) -> None:
    after = None
    stats.update(files_copied=0, files_bytes=0, files_failed=0, files_unmatched=0)
    failed_examples: list[str] = []
    batch_no = 0
    while True:
        plan = rpc("backup_files_plan", {"p_after": after, "p_limit": BATCH})
        items = plan.get("items") or []
        if not items:
            break
        after = plan.get("next_after")
        batch_no += 1
        stage = WORK / "stage"
        shutil.rmtree(stage, ignore_errors=True)
        raw, tree = stage / "raw", stage / "tree"

        # 1. download from Supabase Storage, bucket by bucket
        by_bucket: dict[str, list[dict]] = {}
        for it in items:
            by_bucket.setdefault(it["bucket"], []).append(it)
        for bucket, its in by_bucket.items():
            lst = stage / f"list-{bucket}.txt"
            lst.parent.mkdir(parents=True, exist_ok=True)
            lst.write_text("\n".join(i["name"] for i in its) + "\n", encoding="utf-8")
            rclone("copy", f"supa:{bucket}", str(raw / bucket), "--files-from", str(lst),
                   "--no-traverse", "--transfers", "8", "--retries", "3",
                   "--log-level", "ERROR", check=False)

        # 2. arrange into the human folder tree
        ready = []
        for it in items:
            src = raw / it["bucket"] / it["name"]
            dst = tree / it["drive_path"]
            if not src.is_file():
                stats["files_failed"] += 1
                failed_examples.append(f"download: {it['bucket']}/{it['name']}")
                continue
            if any(len(part.encode("utf-8")) > 250 for part in pathlib.PurePosixPath(it["drive_path"]).parts):
                stats["files_failed"] += 1
                failed_examples.append(f"name too long: {it['drive_path'][:120]}")
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.replace(src, dst)
            ready.append(it)

        # 3. upload, then 4. check what actually landed — the check, not the
        #    exit code, decides what is recorded as backed up
        ok: list[dict] = []
        if ready:
            dest = drive(f"{APP_ROOT}/Files")
            rclone("copy", str(tree), dest, "--no-traverse", "--transfers", "4", "--checkers", "8",
                   "--retries", "5", "--log-level", "ERROR", check=False)
            matched = stage / "matched.txt"
            rclone("check", str(tree), dest, "--one-way", "--size-only", "--match", str(matched),
                   "--log-level", "ERROR", check=False)
            landed = set()
            if matched.exists():
                landed = {ln.strip() for ln in matched.read_text(encoding="utf-8").splitlines() if ln.strip()}
            for it in ready:
                if it["drive_path"] in landed:
                    ok.append(it)
                else:
                    stats["files_failed"] += 1
                    failed_examples.append(f"upload: {it['drive_path'][:120]}")

        if ok:
            rpc("backup_files_done", {"p_run_id": run_id, "p_items": ok})
            stats["files_copied"] += len(ok)
            stats["files_bytes"] += sum(int(i.get("size") or 0) for i in ok)
            stats["files_unmatched"] += sum(1 for i in ok if not i.get("matched"))
        log(f"files batch {batch_no}: {len(ok)} copied, {len(items) - len(ok)} not "
            f"(total {stats['files_copied']}, {human(stats['files_bytes'])})")
        shutil.rmtree(stage, ignore_errors=True)

    if failed_examples:
        stats["files_failed_examples"] = failed_examples[:20]
    if stats["files_failed"]:
        raise RuntimeError(f"{stats['files_failed']} file(s) could not be copied tonight "
                           f"(they will be tried again tomorrow), e.g. {failed_examples[0]}")


# ----------------------------------------------------------------- databases --

def dump_database(label: str, url: str, root: str, prefix: str, keep: int, stats: dict) -> None:
    stamp = now_ist().strftime("%Y-%m-%d_%H%M")
    name = f"{prefix}_{stamp}.dump.age"
    plain = WORK / f"{prefix}_{stamp}.dump"
    enc = WORK / name
    t0 = time.time()

    cmd = [PG_DUMP, "--dbname", url, "--format=custom", "--compress=6", "--no-owner",
           "--lock-wait-timeout=120s", "--exclude-table-data=cron.job_run_details",
           "--file", str(plain)]
    for s in DB_SCHEMAS:
        cmd += ["--schema", s]
    r = subprocess.run(cmd, text=True, capture_output=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        # never echo the command: it carries the password
        raise RuntimeError(f"{label}: pg_dump failed: {(r.stderr or '')[-600:]}")
    dump_bytes = plain.stat().st_size

    r = subprocess.run([AGE, "--encrypt", "--recipient", env("AGE_RECIPIENT"), "--output", str(enc), str(plain)],
                       text=True, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"{label}: encryption failed: {r.stderr[-300:]}")
    plain.unlink()

    md5 = hashlib.md5()
    with enc.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            md5.update(chunk)
    local_md5 = md5.hexdigest()
    enc_bytes = enc.stat().st_size

    folder = f"{root}/Database"
    rclone("copyto", str(enc), drive(f"{folder}/{name}"), "--retries", "5", "--log-level", "ERROR")
    r = rclone("md5sum", drive(f"{folder}/{name}"), capture=True)
    remote_md5 = (r.stdout.split() or [""])[0]
    if remote_md5 != local_md5:
        raise RuntimeError(f"{label}: uploaded copy does not match (md5 {remote_md5} vs {local_md5}); "
                           f"old copies were NOT deleted")
    enc.unlink()
    log(f"{label}: {human(dump_bytes)} dump -> {name} ({human(enc_bytes)}), verified, {time.time() - t0:.0f}s")

    # Retention: count-based, and only now that tonight's copy is proven.
    r = rclone("lsf", drive(folder), "--files-only", capture=True)
    mine = sorted(f for f in r.stdout.splitlines() if f.startswith(prefix + "_") and f.endswith(".dump.age"))
    removed = []
    for old in mine[:-keep] if len(mine) > keep else []:
        rclone("deletefile", drive(f"{folder}/{old}"), "--drive-use-trash=false", "--log-level", "ERROR")
        removed.append(old)
    kept = mine[-keep:]
    if removed:
        log(f"{label}: removed {len(removed)} older copy(ies): {', '.join(removed)}")

    stats[f"{label}_dump_bytes"] = enc_bytes
    stats[f"{label}_dump_raw_bytes"] = dump_bytes
    stats[f"{label}_dump_file"] = f"{folder}/{name}"
    stats[f"{label}_dumps_kept"] = kept
    stats[f"{label}_dumps_removed"] = removed
    stats[f"{label}_seconds"] = round(time.time() - t0)


def check_database(label: str, url: str, stats: dict) -> None:
    """dry-run: prove the login can read everything a real dump needs."""
    cmd = [PG_DUMP, "--dbname", url, "--schema-only", "--no-owner", "--lock-wait-timeout=60s",
           "--file", os.devnull]
    for s in DB_SCHEMAS:
        cmd += ["--schema", s]
    r = subprocess.run(cmd, text=True, capture_output=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{label}: schema-only pg_dump failed: {(r.stderr or '')[-600:]}")
    stats[f"{label}_schema_dump"] = "ok"
    log(f"{label}: schema-only dump OK")


# ---------------------------------------------------------------------- main --

def upload_text(text: str, remote_path: str, local_name: str) -> None:
    p = WORK / local_name
    p.write_text(text, encoding="utf-8", newline="\n")
    rclone("copyto", str(p), drive(remote_path), "--checksum", "--log-level", "ERROR")
    p.unlink()


def run_summary(start: dict, stats: dict, errors: list[str], started: dt.datetime) -> str:
    ok = not errors
    lines = [
        f"Orange One backup - {started:%d %b %Y, %H:%M} IST - {'OK' if ok else 'PROBLEM'}",
        f"Mode: {MODE}",
        "",
        f"Files copied tonight: {stats.get('files_copied', 0)} ({human(stats.get('files_bytes', 0))})",
    ]
    if stats.get("app_dump_file"):
        lines.append(f"Orange One Hub database: {stats['app_dump_file']} ({human(stats.get('app_dump_bytes'))})")
    if stats.get("tally_dump_file"):
        lines.append(f"Tally database: {stats['tally_dump_file']} ({human(stats.get('tally_dump_bytes'))})")
    if stats.get("backup_bytes") is not None:
        lines.append(f"Whole backup folder now: {human(stats['backup_bytes'])}")
    if errors:
        lines += ["", "Problems:"] + [f"- {e}" for e in errors]
        lines += ["", "Nothing older was deleted because of this: old copies are only removed",
                  "after a new one has been saved and checked."]
    lines += ["", f"Finished {now_ist():%H:%M} IST. Run: {os.environ.get('RUNNER_URL', 'local')}"]
    return "\n".join(lines) + "\n"


def main() -> int:
    if MODE not in ("dry-run", "scheduled", "full"):
        raise SystemExit(f"unknown MODE {MODE}")
    WORK.mkdir(parents=True, exist_ok=True)
    started = now_ist()
    runner_url = os.environ.get("RUNNER_URL")

    start = rpc("backup_run_start", {"p_mode": MODE, "p_runner_url": runner_url})
    if not start.get("go"):
        log(f"not due: {start.get('reason')} - nothing to do")
        return 0
    run_id = int(start["run_id"])
    log(f"run {run_id}: mode={MODE}, tally={start['include_tally']}, for {start['for_date']}")

    stats: dict = {"mode": MODE}
    errors: list[str] = []
    try:
        write_rclone_config()

        # Can we reach both ends at all? Cheap, and it makes a dead token fail
        # with a clear message rather than halfway through the files.
        about = json.loads(rclone("about", "gdrive:", "--json", capture=True).stdout or "{}")
        stats["drive_pool_total"] = about.get("total")
        stats["drive_pool_used"] = about.get("used")
        rclone("lsd", "supa:", capture=True)

        if MODE == "dry-run":
            check_database("app", env("APP_DB_URL"), stats)
            check_database("tally", env("TALLY_DB_URL"), stats)
            plan = rpc("backup_files_plan", {"p_after": None, "p_limit": 2000})
            stats["files_waiting"] = len(plan.get("items") or [])
            stats["files_waiting_note"] = "first 2000 counted at most"
            log(f"dry-run: {stats['files_waiting']} file(s) waiting to be copied; nothing was copied")
        else:
            for step, fn in (
                ("files", lambda: backup_files(run_id, stats)),
                ("app database", lambda: dump_database("app", env("APP_DB_URL"), APP_ROOT,
                                                       "orange-one-hub", int(start["keep_app"]), stats)),
                *((("tally database", lambda: dump_database("tally", env("TALLY_DB_URL"), TALLY_ROOT,
                                                             "tally-connectwave", int(start["keep_tally"]), stats)),)
                  if start.get("include_tally") else ()),
            ):
                try:
                    fn()
                except Exception as e:  # one failed step must not stop the others
                    errors.append(f"{step}: {e}")
                    log(f"FAILED {step}: {e}")

            try:
                csv = rpc("backup_files_index_csv", {}, timeout=300) or ""
                upload_text(csv, f"{APP_ROOT}/Files index.csv", "files-index.csv")
                restore = (HERE / "HOW-TO-RESTORE.txt").read_text(encoding="utf-8")
                upload_text(restore, "HOW TO RESTORE.txt", "how-to-restore.txt")
            except Exception as e:
                errors.append(f"index/readme: {e}")

            try:
                size = json.loads(rclone("size", "gdrive:", "--json", "--fast-list", capture=True).stdout or "{}")
                stats["backup_bytes"] = size.get("bytes")
                stats["backup_objects"] = size.get("count")
            except Exception as e:
                errors.append(f"measuring the backup: {e}")

    except Exception as e:
        errors.append(f"{e}")
        traceback.print_exc()

    status = "failed" if errors else "success"
    try:
        summary = run_summary(start, stats, errors, started)
        print(summary)
        if MODE != "dry-run":
            upload_text(summary, f"Run logs/{started:%Y-%m-%d %H%M} - {'OK' if not errors else 'PROBLEM'}.txt",
                        "run-log.txt")
    except Exception as e:
        log(f"could not upload the run log: {e}")

    rpc("backup_run_finish", {"p_run_id": run_id, "p_status": status, "p_details": stats,
                              "p_error": "; ".join(errors)[:2000] if errors else None})
    conf = WORK / "rclone.conf"
    if conf.exists():
        conf.unlink()
    log(f"run {run_id} finished: {status}")
    return 0 if status == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
