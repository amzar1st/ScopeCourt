# ScopeCourt

ScopeCourt is a GenLayer Studionet project for escrowed freelance jobs. The client funds an immutable natural-language scope, the freelancer accepts and commits a hash-bound delivery, and the client approves or disputes it. A disputed delivery is examined by GenLayer validators against the scope and public evidence. The resulting categorical verdict determines claimable payment and refund balances.

## Status

- Contract source: `contracts/scopecourt.py`
- Project submission logo: [`assets/scopecourt-logo.png`](assets/scopecourt-logo.png) (1024×1024 PNG)
- Network target: stable Studionet, chain ID 61999
- Public interface: https://scopecourt.amzar1st96.chatgpt.site
- Deployed contract: [`0x64BD5Fa05a21d1c68EA8F2a77c4D01bE9Fc43D3A`](https://explorer-studio.genlayer.com/address/0x64BD5Fa05a21d1c68EA8F2a77c4D01bE9Fc43D3A)
- Deployment transaction: [`0x4d81dc99e4b04a2f704249f69e74c4f4caa4ffa654c6c4c906285eb87c16b2fb`](https://explorer-studio.genlayer.com/tx/0x4d81dc99e4b04a2f704249f69e74c4f4caa4ffa654c6c4c906285eb87c16b2fb) — FINALIZED, GenVM SUCCESS, consensus Accepted. See `deployment.json`.
- Live finalized read: `get_count() = 0` after deployment. The deployed code matches `contracts/scopecourt.py` apart from its final newline.

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

The verified address is set in `.env.production` for production builds. For local development, copy it to `.env` or set `VITE_CONTRACT_ADDRESS` in your environment, then run `npm run dev`. Wallet writes use the pinned `genlayer-js@1.1.8` Studionet client and wait for finalization. The website needs an injected EIP-1193 wallet; the Studio built-in wallet is used within Studio and does not automatically connect to other websites.

### Evidence format

Evidence must be a public HTTPS URL returning stable UTF-8 bytes of no more than 24 KB. Compute SHA-256 over the exact response bytes, not a browser screenshot or copied text. Avoid pages that change per request, require login, or render content only through JavaScript. Source repositories and static raw files are good choices. The contract re-fetches each commitment when adjudicating; mutable evidence may become unavailable.

### Boundaries

This is a testnet prototype. The deployment and initial finalized read are verified, but a complete live job, dispute, and transfer journey has not yet been recorded. Direct-mode tests do not prove those paths on the network. The protocol does not conceal evidence. Claims emit external value transfers; an unexpected failure requires inspection of the transaction and chain state. Do not use for real funds.
