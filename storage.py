import json
import os
import re


def format_size(bytes_val):
    if bytes_val is None or bytes_val == 0:
        return "0 B"
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if bytes_val < 1024:
            return f"{bytes_val:.1f} {unit}"
        bytes_val /= 1024
    return f"{bytes_val:.1f} PB"


def get_free_space(path):
    try:
        stat = os.statvfs(path)
        return stat.f_frsize * stat.f_bavail
    except (OSError, AttributeError):
        return 0


MULTIPART_PATTERNS = [
    (re.compile(r"^(.+)\.part(\d+)\.rar$", re.IGNORECASE), "rar"),
    (re.compile(r"^(.+)\.r(\d{2,})$", re.IGNORECASE), "rar"),
    (re.compile(r"^(.+)\.7z\.(\d{3,})$", re.IGNORECASE), "7z"),
    (re.compile(r"^(.+)\.(\d{3,})$", re.IGNORECASE), None),
]


def _detect_multipart(filename):
    for pattern, archive_type in MULTIPART_PATTERNS:
        match = pattern.match(filename)
        if match:
            base = match.group(1)
            part_num = int(match.group(2))
            return base, part_num, archive_type
    return None, None, None


def _season_replacer(match):
    season = int(match.group(1))
    return f" S{season} "


def suggest_folder_name(filename, search_query=""):
    name = filename
    name = re.sub(r"\.part\d+", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.r\d{2,}$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.\d{3,}$", "", name)

    for ext in [".rar", ".zip", ".7z", ".tar.gz", ".tar.bz2", ".tar", ".tgz", ".tbz2"]:
        if name.lower().endswith(ext):
            name = name[:-len(ext)]
            break

    for ext in [".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts"]:
        if name.lower().endswith(ext):
            name = name[:-len(ext)]
            break

    name = re.sub(r"[._\s]*(\d{1,2})x\d{1,3}[._\s]*", _season_replacer, name, flags=re.IGNORECASE)
    name = re.sub(r"[._\s]*[Ss](\d{1,2})[Ee]\d{1,3}[._\s]*", _season_replacer, name)
    name = re.sub(r"[._\s]*[Ee]\d{1,3}[._\s]*", " ", name)

    name = re.sub(r"[._]+", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _strip_season(name):
    return re.sub(r"\b[Ss]\d+\b\s*", "", name).strip()


def create_movie_folder(base_dir, name):
    sanitized = _sanitize_name(name)
    if not sanitized:
        sanitized = "descarga"
    path = os.path.join(base_dir, sanitized)
    if os.path.isdir(path):
        return path
    base = _strip_season(sanitized)
    if base != sanitized:
        base_path = os.path.join(base_dir, base)
        if os.path.isdir(base_path):
            return base_path
    os.makedirs(path, exist_ok=True)
    return path


def _sanitize_name(name):
    return re.sub(r'[<>:"/\\|?*]', "", name).strip()


PAUSED_FILE = "paused_batches.json"


def save_paused_batch(batch_id, batch_data):
    batches = load_paused_batches()
    serializable = {
        "batch_id": batch_data["batch_id"],
        "base_name": batch_data.get("base_name", ""),
        "folder_name": batch_data["folder_name"],
        "folder_path": batch_data["folder_path"],
        "total_parts": batch_data["total_parts"],
        "total_size": batch_data.get("total_size", 0),
        "total_size_str": batch_data.get("total_size_str", ""),
        "downloaded_parts": batch_data["downloaded_parts"],
        "downloaded_size": batch_data.get("downloaded_size", 0),
        "parts": [{
            "message_id": p["message_id"],
            "file_name": p["file_name"],
            "part_num": p.get("part_num", 0),
            "size": p.get("size", 0),
            "size_str": p.get("size_str", ""),
            "status": "pending" if p["status"] == "downloading" else p["status"],
            "downloaded": p.get("downloaded", 0),
            "progress": 0,
        } for p in batch_data["parts"]],
    }
    batches[batch_id] = serializable
    with open(PAUSED_FILE, "w") as f:
        json.dump(batches, f, indent=2)


def load_paused_batches():
    if not os.path.exists(PAUSED_FILE):
        return {}
    with open(PAUSED_FILE) as f:
        return json.load(f)


def delete_paused_batch(batch_id):
    batches = load_paused_batches()
    batches.pop(batch_id, None)
    with open(PAUSED_FILE, "w") as f:
        json.dump(batches, f, indent=2)


def get_paused_batch(batch_id):
    return load_paused_batches().get(batch_id)
