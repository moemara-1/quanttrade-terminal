# Assistant native order preparation repair

The supplied conversation exposed a real missing server connection revision while Lighter remained configured in Live mode. A revision does not expire. Fresh preparation can now request operator-only recovery of that metadata, using the existing verified Hummingbot signer/account and a canonical credential fingerprint computed inside the private API. Credentials are never returned or replaced. Approval of an old card does not recover or rebind its scope, and old paused plans are not resumed.

The model also selected OCO for an entry and stop-loss. That combination requires OTO; entry plus TP and SL requires OTOCO; OCO is for paired exits. Tool instructions and errors now explain these distinctions. Terminal perpetual aliases normalize to the exact native Lighter symbol before review.

Live verification also exposed an upstream loader mismatch: the Lighter account tier was saved as an encrypted SecretStr but skipped by generic secure-field decoding. A targeted loader repair decodes only the Lighter tier before connector construction. Signing keys, credential files and strict identity comparison are unchanged. Tests exercise the actual adapter methods, and the repaired existing signer passes the private live verification probe.

Assistant guidance separates margin allocation, leverage and base quantity, preserves exact venue identity, avoids redundant research after execution instructions, and prohibits workflow bypasses of connection failures. The SDK tool loop stops once a trading preparation returns its confirmation card. Invalid preparation can still be corrected, and research or scripting retains its normal step limit. Concurrent calls within the same model step are not made atomic by this stop condition.

Testing uses mock orders and provider streams. Deployment verifies the existing live signing scope and recovers only missing metadata; it never submits a trade or resumes a paused plan. Native and managed capabilities keep their existing labels and protection limitations.
