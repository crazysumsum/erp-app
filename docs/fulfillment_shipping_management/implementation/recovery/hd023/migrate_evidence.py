#!/usr/bin/env python3
"""One reviewed HD023 metadata repair. Dry-run unless explicit approval is observed."""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import sys

PACKAGE = Path(__file__).resolve().parent
MODULE = PACKAGE.parents[2]
REPO = MODULE.parents[1]
INDEX_SHA = "7c223ccd91b39298bdeacca2c56465be70609b61134da31e355e449cf1adf314"
SNAPSHOT_SHA = "8ad92e2987bf1573f27a1e6cded01ba3d744157d45ca87417e4f68dd15414607"
ACTION = "HD023-EVIDENCE-REFERENCE-REPAIR"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def index_entries():
    raw = (PACKAGE / "exact-reference-index.json").read_bytes()
    require(sha(raw) == INDEX_SHA, "Immutable index changed")
    snapshot = (PACKAGE / "original-state.json").read_bytes()
    require(sha(snapshot) == SNAPSHOT_SHA, "Immutable original state changed")
    index, original = json.loads(raw), json.loads(snapshot)
    entries = index["entries"]
    require(index["state_sha256"] == SNAPSHOT_SHA and index["state_revision"] == 185,
            "Wrong recovery baseline")
    require([row["reference"] for row in entries] == original["evidence_files"],
            "Index is not the exact ordered original references")
    require(len(entries) == 64 and sum(row["present"] for row in entries) == 20,
            "Unexpected recovery scope")
    for ordinal, row in enumerate(entries):
        require(row["ordinal"] == ordinal, "Index order changed")
        path = MODULE / row["reference"]
        require(not any(parent.is_symlink() for parent in [path, *path.parents]),
                "Symlink in evidence path")
        require(path.resolve().is_relative_to(MODULE), "Evidence path escapes module")
        if row["present"]:
            require(row["classification"] == "NARRATIVE_REPORT" and path.suffix == ".md"
                    and path.is_file() and sha(path.read_bytes()) == row["original_sha256"],
                    "Narrative changed; review a new index before repair")
        else:
            require(row["classification"] == "UNAVAILABLE_HISTORICAL_RUN"
                    and path.name == "run.json" and not path.exists()
                    and row["original_sha256"] is None,
                    "Historical run recovered or classification changed; stop and reconcile")
    return entries


def propose(old, entries, tool_sha, approval_ref, old_state_sha):
    references = [row["reference"] for row in entries]
    require(old["module_id"] == "fulfillment-shipping-management", "Wrong module")
    require(not any(row["id"] == ACTION for row in old["external_actions"]),
            "Repair already recorded; inspect rather than replay")
    require(set(references) <= set(old["evidence_files"]), "Original pointer already removed")
    new = copy.deepcopy(old)
    new["revision"] += 1
    new["evidence_files"] = [ref for ref in old["evidence_files"] if ref not in references]
    new["external_actions"].append({
        "id": ACTION, "kind": "LOCAL_STATE_REPAIR", "target": "evidence_files exact64 HD023 index only",
        "idempotency_key": "hd023-" + INDEX_SHA, "status": "CONFIRMED",
        "source_ref": f"{approval_ref}; implementation/recovery/hd023/exact-reference-index.json "
                      f"SHA{INDEX_SHA}; original-state.json SHA{SNAPSHOT_SHA}; "
                      f"migrate_evidence.py SHA{tool_sha}; pre-repair revision{old['revision']}; "
                      f"implementation/recovery/hd023/pre-repair-{old_state_sha}.json SHA{old_state_sha}; "
                      "44 originals UNAVAILABLE/UNKNOWN,20 narrative references archived; "
                      "no qualification, test/CI waiver or task completion conferred"
    })
    require({key for key in old if old[key] != new[key]} ==
            {"revision", "evidence_files", "external_actions"}, "Unexpected field mutation")
    require(new["external_actions"][:-1] == old["external_actions"], "History mutation")
    return new


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-revision", type=int, required=True)
    parser.add_argument("--expected-state-sha", required=True)
    parser.add_argument("--expected-tool-sha", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    require(MODULE == REPO / "docs/fulfillment_shipping_management", "Wrong module location")
    state_path = MODULE / "00_harness_state.json"
    require(not any(path.is_symlink() for path in [state_path, *state_path.parents]),
            "Symlink in state path")
    tool_sha = sha(Path(__file__).read_bytes())
    require(tool_sha == args.expected_tool_sha, "Tool differs from reviewed digest")
    entries = index_entries()
    lock = MODULE / ".00_harness_state.json.lock"
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(fd, str(os.getpid()).encode())
        os.fsync(fd)
        raw = state_path.read_bytes()
        old = json.loads(raw)
        require(old["revision"] == args.expected_revision and sha(raw) == args.expected_state_sha,
                "State CAS conflict: reload and review; no automatic retry")
        approval = next((row for row in old["pending_decisions"] if row["id"] == "HD-023"), None)
        if args.apply:
            require(approval and approval["status"] == "ANSWERED" and approval["answer_ref"]
                    and INDEX_SHA in approval["answer_ref"] and tool_sha in approval["answer_ref"],
                    "Actual HD023 approval bound to this index/tool is required")
        approval_ref = approval["answer_ref"] if approval and approval["status"] == "ANSWERED" else "DRY_RUN_NOT_AUTHORIZED"
        new = propose(old, entries, tool_sha, approval_ref, sha(raw))
        sys.path.insert(0, "/Users/sam/.agents/skills/software-engineering-harness/scripts")
        from harness_core import Context, inside, load_schema, typed_json, validate_schema, write_json_atomic
        from harness_checks import validate_state
        # Validation uses the unmodified official schema and observed baseline policy.
        ctx = Context(MODULE, REPO)
        require(ctx.state == old, "State changed during context construction")
        if args.apply:
            require(not validate_state(ctx, observed=True), "Observed state must be reconciled first")
        for ref in new["evidence_files"]:
            path = inside(MODULE, ref, True)
            require(not any(parent.is_symlink() for parent in [MODULE / ref, *(MODULE / ref).parents]),
                    "Symlink in retained evidence path")
            typed_json(path, "evidence")
        require(not validate_schema(new, load_schema("state"), "proposed-state"),
                "Proposed state fails official typed schema")
        ctx.state = new
        require(not validate_state(ctx, observed=args.apply), "Proposed state fails official validation")
        if args.apply:
            before_path = PACKAGE / f"pre-repair-{sha(raw)}.json"
            require(not before_path.is_symlink(), "Symlink in immutable archive path")
            if before_path.exists():
                require(before_path.read_bytes() == raw, "Archive collision")
            else:
                archive_fd = os.open(before_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(archive_fd, "wb") as archive:
                    archive.write(raw)
                    archive.flush()
                    os.fsync(archive.fileno())
            # Recheck all authoritative bytes immediately before the atomic mutation.
            index_entries()
            require(state_path.read_bytes() == raw and sha(Path(__file__).read_bytes()) == tool_sha,
                    "State/tool changed while locked")
            write_json_atomic(state_path, new)
        print(json.dumps({"status": "RECORDED_NO_GATE_QUALIFICATION" if args.apply else "DRY_RUN_ONLY",
                          "old_revision": old["revision"], "proposed_revision": new["revision"],
                          "pre_repair_state_sha256": sha(raw),
                          "removed_active_pointers": 64, "preserved_new_evidence": len(new["evidence_files"]),
                          "changed_fields": ["revision", "evidence_files", "external_actions"],
                          "index_sha256": INDEX_SHA, "tool_sha256": tool_sha}))
    finally:
        os.close(fd)
        lock.unlink()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(f"BLOCKED: {error}")
