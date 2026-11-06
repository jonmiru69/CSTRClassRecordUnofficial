"""Extract school identity fields from the DepEd Project Bukas enrollment ZIP."""

import argparse
import csv
import hashlib
import io
import json
from datetime import date
from pathlib import Path
from zipfile import ZipFile


REGIONS = {
    "NCR": ("ncr", "National Capital Region (NCR)"),
    "CAR": ("car", "Cordillera Administrative Region (CAR)"),
    "Region I": ("region-1", "Region I · Ilocos Region"),
    "Region II": ("region-2", "Region II · Cagayan Valley"),
    "Region III": ("region-3", "Region III · Central Luzon"),
    "Region IV-A": ("region-4a", "Region IV-A · CALABARZON"),
    "MIMAROPA": ("mimaropa", "MIMAROPA"),
    "Region V": ("region-5", "Region V · Bicol Region"),
    "Region VI": ("region-6", "Region VI · Western Visayas"),
    "NIR": ("nir", "Negros Island Region (NIR)"),
    "Region VII": ("region-7", "Region VII · Central Visayas"),
    "Region VIII": ("region-8", "Region VIII · Eastern Visayas"),
    "Region IX": ("region-9", "Region IX · Zamboanga Peninsula"),
    "Region X": ("region-10", "Region X · Northern Mindanao"),
    "Region XI": ("region-11", "Region XI · Davao Region"),
    "Region XII": ("region-12", "Region XII · SOCCSKSARGEN"),
    "CARAGA": ("caraga", "Region XIII · Caraga"),
    "BARMM": ("barmm", "Bangsamoro Autonomous Region (BARMM)"),
}
SOURCE = "https://www.deped.gov.ph/machine-ready-files/"
SECTORS = {"Public": "public", "Private": "private", "SUCsLUCs": "public"}


def text(value):
    return " ".join(value.split())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--retrieved", type=date.fromisoformat, required=True)
    args = parser.parse_args()
    archive_hash = hashlib.sha256(args.archive.read_bytes()).hexdigest()
    with ZipFile(args.archive) as archive:
        csv_path, = (name for name in archive.namelist() if name.endswith(".csv"))
        raw = archive.read(csv_path)
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        decoded = raw.decode("cp1252")
    schools = []
    for row in csv.DictReader(io.StringIO(decoded, newline="")):
        if row["region"] == "PSO" and row["sector"] == "PSO":
            continue
        region, label = REGIONS[row["region"]]
        sector = SECTORS[row["sector"]]
        schools.append({
            "schoolId": row["school_id"].strip(),
            "name": text(row["school_name"]),
            "sector": sector,
            "classification": "SUC/LUC" if row["sector"] == "SUCsLUCs" else "",
            "locality": text(row["municipality"]),
            "province": text(row["province"]),
            "region": region,
            "regionLabel": label,
        })
    if len({school["region"] for school in schools}) != len(REGIONS):
        raise ValueError("Expected school rows from all Philippine regions")
    payload = {
        "version": "deped-bukas-2025-26-v1",
        "schoolYear": "2025–2026",
        "snapshot": args.retrieved.isoformat(),
        "sourceUrl": SOURCE,
        "downloadUrl": "https://www.deped.gov.ph/wp-content/uploads/Enrollment-in-SY-2025-2026.zip",
        "sourceSha256": archive_hash,
        "rightsEvidenceUrl": SOURCE,
        "rightsConfirmedOn": args.retrieved.isoformat(),
        "schools": schools,
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Extracted {len(schools):,} Philippine school identities")


if __name__ == "__main__":
    main()
