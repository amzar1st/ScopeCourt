import hashlib
import json
import time
from datetime import datetime, timezone

import pytest

PATH = "contracts/scopecourt.py"
ESCROW = 10**18


def job(contract):
    return json.loads(contract.get_job(1))


def warp(vm, timestamp):
    vm.warp(datetime.fromtimestamp(timestamp, timezone.utc).isoformat())


def create(vm, deploy, alice, bob):
    contract = deploy(PATH, sdk_version="v0.2.12")
    vm.sender = alice
    vm.value = ESCROW
    contract.create_job("0x" + bytes(bob).hex(), "Landing page", "Responsive page with checkout", 2, 10)
    vm.value = 0
    return contract


def delivered(vm, contract, bob):
    vm.sender = bob
    contract.accept_job(1)
    contract.submit_delivery(1, "https://example.org/delivery", hashlib.sha256(b"delivery").hexdigest())


def test_create_accept_approve_and_escrow(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = create(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert c.get_total_locked() == ESCROW
    with direct_vm.expect_revert("cannot accept"):
        c.accept_job(1)
    delivered(direct_vm, c, direct_bob)
    direct_vm.sender = direct_alice
    c.approve_delivery(1)
    assert job(c)["freelancer_due"] == ESCROW
    with direct_vm.expect_revert("claimant"):
        c.claim_payment(1)


def test_accept_and_delivery_timeout(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = create(direct_vm, direct_deploy, direct_alice, direct_bob)
    warp(direct_vm, job(c)["accept_by"] + 1)
    c.finalize(1)
    assert job(c)["client_due"] == ESCROW
    with direct_vm.expect_revert("cannot accept"):
        direct_vm.sender = direct_bob
        c.accept_job(1)


def test_dispute_permission_capacity_and_deadline(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = create(direct_vm, direct_deploy, direct_alice, direct_bob)
    delivered(direct_vm, c, direct_bob)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("cannot dispute"):
        c.open_dispute(1, "missing checkout")
    direct_vm.sender = direct_alice
    c.open_dispute(1, "missing checkout")
    digest = hashlib.sha256(b"evidence").hexdigest()
    for i in range(3):
        c.submit_evidence(1, f"https://example.org/client-{i}", digest)
    with direct_vm.expect_revert("capacity"):
        c.submit_evidence(1, "https://example.org/fourth", digest)
    direct_vm.sender = direct_bob
    c.submit_evidence(1, "https://example.org/freelancer", digest)
    assert len(job(c)["freelancer_evidence"]) == 2
    warp(direct_vm, job(c)["evidence_by"] + 1)
    with direct_vm.expect_revert("window closed"):
        c.submit_evidence(1, "https://example.org/later", digest)


def test_review_timeout_pays_freelancer(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = create(direct_vm, direct_deploy, direct_alice, direct_bob)
    delivered(direct_vm, c, direct_bob)
    warp(direct_vm, job(c)["review_by"] + 1)
    c.finalize(1)
    assert job(c)["verdict"] == "DELIVERED"


def test_adjudication_and_validator_independence(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = create(direct_vm, direct_deploy, direct_alice, direct_bob)
    delivered(direct_vm, c, direct_bob)
    direct_vm.sender = direct_alice
    c.open_dispute(1, "Checkout is absent")
    warp(direct_vm, job(c)["evidence_by"] + 1)
    direct_vm.mock_web(r"example.org/delivery", {"method": "GET", "status": 200, "body": "delivery"})
    direct_vm.mock_llm(r".*", {"verdict": "PARTIALLY_DELIVERED", "reason": "Partial implementation"})
    c.adjudicate(1)
    assert job(c)["client_due"] + job(c)["freelancer_due"] == ESCROW
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example.org/delivery", {"method": "GET", "status": 200, "body": "delivery"})
    direct_vm.mock_llm(r".*", {"verdict": "DELIVERED", "reason": "Opposite conclusion"})
    assert direct_vm.run_validator() is False


def test_insufficient_evidence_is_not_full_refund(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = create(direct_vm, direct_deploy, direct_alice, direct_bob)
    delivered(direct_vm, c, direct_bob)
    direct_vm.sender = direct_alice
    c.open_dispute(1, "Need review")
    warp(direct_vm, job(c)["evidence_by"] + 1)
    direct_vm.mock_web(r"example.org/delivery", {"method": "GET", "status": 200, "body": "delivery"})
    direct_vm.mock_llm(r".*", {"verdict": "INSUFFICIENT_EVIDENCE", "reason": "Ambiguous"})
    c.adjudicate(1)
    assert job(c)["client_due"] == ESCROW // 2
    assert job(c)["freelancer_due"] == ESCROW // 2


def test_bad_delivery_hash_enters_retry_then_refund(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = create(direct_vm, direct_deploy, direct_alice, direct_bob)
    delivered(direct_vm, c, direct_bob)
    direct_vm.sender = direct_alice
    c.open_dispute(1, "Missing checkout")
    warp(direct_vm, job(c)["evidence_by"] + 1)
    direct_vm.mock_web(r"example.org/delivery", {"method": "GET", "status": 200, "body": "tampered"})
    c.adjudicate(1)
    assert job(c)["state"] == "EVIDENCE_REVIEW"
    assert direct_vm.run_validator() is True
    warp(direct_vm, job(c)["retry_by"] + 1)
    c.finalize(1)
    assert job(c)["client_due"] == ESCROW
    assert c.get_total_locked() == ESCROW


def test_client_bad_evidence_cannot_force_refund(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = create(direct_vm, direct_deploy, direct_alice, direct_bob)
    delivered(direct_vm, c, direct_bob)
    direct_vm.sender = direct_alice
    c.open_dispute(1, "Missing checkout")
    c.submit_counter_evidence(1, "https://example.org/bad-client", "0" * 64)
    warp(direct_vm, job(c)["evidence_by"] + 1)
    direct_vm.mock_web(r"example.org/delivery", {"method": "GET", "status": 200, "body": "delivery"})
    direct_vm.mock_web(r"example.org/bad-client", {"method": "GET", "status": 200, "body": "wrong"})
    direct_vm.mock_llm(r".*", {"verdict": "DELIVERED", "reason": "No valid counter-evidence"})
    c.adjudicate(1)
    assert job(c)["freelancer_due"] == ESCROW


def test_refund_claim_is_single_use(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = create(direct_vm, direct_deploy, direct_alice, direct_bob)
    warp(direct_vm, job(c)["accept_by"] + 1)
    c.finalize(1)
    direct_vm.sender = direct_alice
    c.claim_refund(1)
    assert job(c)["client_due"] == 0
    assert c.get_total_locked() == 0
    with direct_vm.expect_revert("nothing to claim"):
        c.claim_refund(1)
