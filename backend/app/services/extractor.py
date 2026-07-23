import os
import re
import subprocess
import tarfile
import zipfile

import rarfile
import py7zr


def extract_archive(file_path, output_dir, delete_after=True):
    fname = file_path.lower()
    os.makedirs(output_dir, exist_ok=True)

    if fname.endswith(".rar") or ".part" in fname:
        return _extract_rar(file_path, output_dir, delete_after)

    elif re.search(r"\.7z\.\d{3,}$", fname):
        return _extract_split_7z(file_path, output_dir, delete_after)

    elif fname.endswith(".7z"):
        return _extract_7z(file_path, output_dir, delete_after)

    elif re.search(r"\.zip\.\d{3,}$", fname):
        return _extract_split_zip(file_path, output_dir, delete_after)

    elif fname.endswith(".zip"):
        return _extract_zip(file_path, output_dir, delete_after)

    elif fname.endswith((".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar")):
        return _extract_tar(file_path, output_dir, delete_after)

    return [file_path], False


def _extract_rar(file_path, output_dir, delete_after):
    if ".part" in file_path.lower() and not file_path.lower().endswith(".part1.rar"):
        match = re.match(r"(.+?)\.part0*1\.rar$", file_path, re.IGNORECASE)
        if not match:
            base = re.sub(r"\.part\d+\.rar$", "", file_path, flags=re.IGNORECASE)
            first_part = base + ".part1.rar"
            if os.path.exists(first_part):
                file_path = first_part
            else:
                alt = base + ".rar"
                if os.path.exists(alt):
                    file_path = alt

    with rarfile.RarFile(file_path) as rf:
        rf.extractall(output_dir)
        extracted = [os.path.join(output_dir, f) for f in rf.namelist()]

    if delete_after:
        _cleanup_rar_parts(file_path)

    return extracted, True


def _cleanup_rar_parts(file_path):
    base = re.sub(r"\.part\d+\.rar$", "", file_path, flags=re.IGNORECASE)
    directory = os.path.dirname(file_path)
    for f in os.listdir(directory):
        fpath = os.path.join(directory, f)
        if f.startswith(os.path.basename(base)) and re.search(r"\.(rar|part\d+\.rar|r\d+)$", f, re.IGNORECASE):
            try:
                os.remove(fpath)
            except OSError:
                pass


def _extract_split_7z(file_path, output_dir, delete_after):
    match = re.match(r"(.+\.7z)\.(\d{3,})$", file_path, re.IGNORECASE)
    if not match:
        return [file_path], False

    base = match.group(1)
    directory = os.path.dirname(file_path)
    base_name = os.path.basename(base)
    pattern = re.compile(re.escape(base_name) + r"\.(\d{3,})$", re.IGNORECASE)

    parts = []
    for f in os.listdir(directory):
        m = pattern.match(f)
        if m:
            parts.append((int(m.group(1)), os.path.join(directory, f)))
    parts.sort(key=lambda x: x[0])

    if not parts:
        return [file_path], False

    subprocess.run(["7z", "x", file_path, f"-o{output_dir}", "-y"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    extracted = [os.path.join(output_dir, f)
                 for f in os.listdir(output_dir)
                 if os.path.isfile(os.path.join(output_dir, f))]

    if delete_after:
        for _, part_path in parts:
            try:
                os.remove(part_path)
            except OSError:
                pass

    return extracted, True


def _extract_7z(file_path, output_dir, delete_after):
    with py7zr.SevenZipFile(file_path, "r") as sz:
        sz.extractall(output_dir)
        extracted = [os.path.join(output_dir, f) for f in sz.getnames()]
    if delete_after:
        _cleanup_split_parts(file_path)
    return extracted, True


def _cleanup_split_parts(file_path):
    directory = os.path.dirname(file_path)
    base = re.sub(r"(\.zip|\.7z)?\.\d{3,}$", r"\1", file_path, flags=re.IGNORECASE)
    basename_no_ext = os.path.basename(base)
    escaped = re.escape(basename_no_ext)
    pattern = re.compile(r"^" + escaped + r"\.\d{3,}$", re.IGNORECASE)
    for f in os.listdir(directory):
        if pattern.match(f) or f == os.path.basename(file_path):
            try:
                os.remove(os.path.join(directory, f))
            except OSError:
                pass


def _extract_split_zip(file_path, output_dir, delete_after):
    match = re.match(r"(.+\.zip)\.(\d{3,})$", file_path, re.IGNORECASE)
    if not match:
        return [file_path], False

    base = match.group(1)
    directory = os.path.dirname(file_path)
    base_name = os.path.basename(base)
    pattern = re.compile(re.escape(base_name) + r"\.(\d{3,})$", re.IGNORECASE)

    parts = []
    for f in os.listdir(directory):
        m = pattern.match(f)
        if m:
            parts.append((int(m.group(1)), os.path.join(directory, f)))
    parts.sort(key=lambda x: x[0])

    if not parts:
        return [file_path], False

    combined_zip = os.path.join(output_dir, base_name)
    with open(combined_zip, "wb") as outfile:
        for _, part_path in parts:
            with open(part_path, "rb") as infile:
                outfile.write(infile.read())

    with zipfile.ZipFile(combined_zip, "r") as zf:
        zf.extractall(output_dir)
        extracted = [os.path.join(output_dir, f) for f in zf.namelist()]

    os.remove(combined_zip)
    if delete_after:
        for _, part_path in parts:
            try:
                os.remove(part_path)
            except OSError:
                pass

    return extracted, True


def _extract_zip(file_path, output_dir, delete_after):
    with zipfile.ZipFile(file_path, "r") as zf:
        zf.extractall(output_dir)
        extracted = [os.path.join(output_dir, f) for f in zf.namelist()]
    if delete_after:
        os.remove(file_path)
    return extracted, True


def _extract_tar(file_path, output_dir, delete_after):
    fname = file_path.lower()
    if fname.endswith((".tar.gz", ".tgz")):
        mode = "r:gz"
    elif fname.endswith((".tar.bz2", ".tbz2")):
        mode = "r:bz2"
    else:
        mode = "r"

    with tarfile.open(file_path, mode) as tf:
        tf.extractall(output_dir)
        extracted = [os.path.join(output_dir, f) for f in tf.getnames()]

    if delete_after:
        os.remove(file_path)
    return extracted, True


def find_first_archive(files):
    lookup = {os.path.basename(f).lower(): f for f in files}
    for f in sorted(files):
        base = os.path.basename(f).lower()
        if base.endswith(".part1.rar"):
            return f
        if base.endswith(".rar") and not any(
            k.endswith(".part1.rar") for k in lookup
        ):
            return f
        if base.endswith(".001"):
            return f
    if files:
        return files[0]
    return None
