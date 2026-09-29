# ScopeCourt

ScopeCourt is a GenLayer Studionet project for escrowed freelance jobs. The client funds an immutable natural-language scope, the freelancer accepts and commits a hash-bound delivery, and the client approves or disputes it. A disputed delivery is examined by GenLayer validators against the scope and public evidence. The resulting categorical verdict determines claimable payment and refund balances.

## Status

- Contract source: `contracts/scopecourt.py`
- Network target: stable Studionet, chain ID 61999
- Verified deployment: **pending**. Do not treat this repository as proof of an on-chain deployment until `deployment.json` has a finalized transaction and a matching explorer record.
- The app intentionally disables wallet writes until `VITE_CONTRACT_ADDRESS` is set to a verified deployed address.

## Settlement rules

| Result | Client | Freelancer |
| --- | ---: | ---: |
| DELIVERED | 0% | 100% |
| PARTIALLY_DELIVERED | 50% | 50% |
| NOT_DELIVERED | 100% | 0% |
| INSUFFICIENT_EVIDENCE | 50% | 50% |

Acceptance, delivery, review, evidence, and retry deadlines have contract-enforced exits. Each side has three evidence slots; the delivery uses the freelancer's first slot. All evidence is public HTTPS content with an immutable SHA-256 commitment. Freelancer fetch failures enter a bounded evidence review and then refund the client if still unresolved. Client fetch failures do not produce an automatic client refund. Validators independently fetch evidence and compare the categorical decision.

### Run locally

```sh
python -m pip install genlayer-test genvm-linter pytest
python -m pytest tests -q
genvm-lint contracts/scopecourt.py
npm ci
npm run build
```

After a finalized deployment, set `VITE_CONTRACT_ADDRESS=0x...` in the hosting build environment and rebuild. Run `npm run dev` for local UI development. Wallet writes use the pinned `genlayer-js@1.1.8` stable Studionet client and wait for finalization. An injected EIP-1193 wallet is required for signing.

### Evidence format

Evidence must be a public HTTPS URL returning stable UTF-8 bytes of no more than 24 KB. Compute SHA-256 over the exact response bytes, not a browser screenshot or copied text. Avoid pages that change per request, require login, or render content only through JavaScript. Source repositories and static raw files are good choices. The contract re-fetches each commitment when adjudicating; mutable evidence may become unavailable.

### Boundaries

This is a testnet prototype. A direct-mode test does not prove validator execution, finality, real transfers, or a live user journey. The protocol does not conceal evidence. Claims emit external value transfers on finalization; an unexpected failure of a child transfer requires inspection of the transaction and chain state. Do not use for real funds.
